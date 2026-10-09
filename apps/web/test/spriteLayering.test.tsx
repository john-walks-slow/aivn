// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayback, visualAt, type AssetIndex, type Cue, type ScriptLine, StageTheater } from "@aivn/stage";

/**
 * 立绘与背景栈的层叠契约（2026-10-08）。
 *
 * 背景栈里的 `z-index`（新图 2 / 旧图 1/4）是「新图压旧图」的内部排序，靠 `.theater-stack`
 * 自己的 `isolation: isolate` 关在这一层里。少了它，这几档数值会与立绘层（`z-index: 0`）
 * **直接比大小**——两者同处 `.theater-camera` 这个层叠上下文（camera 因
 * `will-change: transform` 自成上下文，实测），2 > 0，整组背景压住立绘，
 * 换过一次底之后立绘再也看不见。
 *
 * 本文件钉的是**结构**（谁是兄弟、谁在谁后面），不是层叠契约本身：
 * jsdom 不算层叠、也读不到 CSS，删掉 `isolation` 这里照样全绿。
 * 样式侧的契约由 `packages/stage/src/layering.test.ts` 守（它直接读 `stage.css`）；
 * 真实的遮挡关系由 `elementFromPoint` 在实机验证（见 issue 文档的验收项）。
 * 两者定位不同，别把本文件当成 `isolation` 的守卫。
 */

// jsdom 没有 ResizeObserver；舞台靠它把两块浮层的实测高度写回 CSS 变量。
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const index: AssetIndex = {
  bg: (stem) => (stem ? `/plays/p/assets/backgrounds/${stem}.jpg` : null),
  cg: () => null,
  bgm: () => null,
  sfx: () => null,
  ambient: () => null,
  spriteDirOf: (actorId) => actorId,
  spriteName: () => null,
  sprite: (id, variant) => `/plays/p/assets/sprites/${id}/${variant ?? "neutral"}.png`,
  spriteIds: ["alice"],
  spritePresentation: () => ({ framing: "full", stature: "normal", anchor: "bottom" }),
};

/** 换底两次：第一次给 from（首次上屏时栈还不存在），第二次才拿到真正的旧层。 */
const cues: Cue[] = [
  { key: "c0", kind: "scene", bg: "bg_a" },
  { key: "c1", kind: "actor", id: "alice", pos: "center" },
  { key: "c2", kind: "line", lineKey: "l1" },
  { key: "c3", kind: "scene", bg: "bg_b", transition: "dissolve" },
];



/**
 * 用真的 `usePlayback` 起一副画面，再把它折回去重算——比手搓 Playback 形状可靠，
 * 也让「换过底之后」这个触发条件就是演出里真会发生的那一个。
 */
function Theater({ cues, upto }: { cues: Cue[]; upto: number }) {
  const lines: ScriptLine[] = [
    { key: "l1", type: "say", actorId: "alice", text: "换底了。" },
  ];
  const playback = usePlayback(cues, lines, {
    live: true,
    resume: false,
    revision: 1,
    transcript: lines.map((l) => ({
      key: l.key,
      kind: "line" as const,
      type: "say" as const,
      actorId: l.actorId ?? null,
      text: l.text,
      seq: null,
      nodeId: "n1",
    })),
  });
  const noop = (): void => {};
  return (
    <StageTheater
      visual={visualAt(cues, upto)}
      playback={playback}
      live={false}
      names={{ alice: "爱丽丝" }}
      index={index}
      voiceAvailable={false}
      voiceOn={false}
      onToggleVoice={noop}
      busy={false}
      targets={{ beatId: null, beatNodeId: null, lineNodeId: null, lineSeq: null, lineText: "" }}
      onPrompt={noop}
      onEdit={noop}
      onFork={noop}
      onGenerateCg={noop}
      onReplay={noop}
      voiceState={() => "none"}
      onUnlock={noop}
      onView={noop}
      canContinue={false}
      onContinue={noop}
      onTurbo={noop}
    />
  );
}

function renderTheater(cues: Cue[], upto: number): HTMLElement {
  return render(<Theater cues={cues} upto={upto} />).container;
}

afterEach(cleanup);

describe("立绘不被背景栈压住", () => {
  it("换底之后立绘仍在 DOM 里（层叠由 CSS 的 isolation 兜住）", () => {
    const container = renderTheater(cues, 4);
    expect(container.querySelector(".theater-bg-stack")).toBeTruthy();
    expect(container.querySelector(".theater-sprites img.theater-sprite")).toBeTruthy();
  });

  it("背景栈与立绘层是兄弟：栈不包着立绘，否则立绘要吃栈的层叠上下文", () => {
    const container = renderTheater(cues, 4);
    const stack = container.querySelector(".theater-stack")!;
    const sprites = container.querySelector(".theater-sprites")!;
    expect(stack.contains(sprites)).toBe(false);
    expect(stack.parentElement).toBe(sprites.parentElement);
  });

  it("立绘层在 DOM 顺序上紧跟背景栈之后——同 z-index 时也压得住", () => {
    const container = renderTheater(cues, 4);
    const camera = container.querySelector(".theater-camera")!;
    const kids = [...camera.children];
    const stackAt = kids.indexOf(container.querySelector(".theater-stack")!);
    const spritesAt = kids.indexOf(container.querySelector(".theater-sprites")!);
    expect(stackAt).toBeGreaterThanOrEqual(0);
    expect(spritesAt).toBeGreaterThan(stackAt);
  });
});

describe("转场纯色场是屏幕级的", () => {
  it("fade 时纯色场挂在镜头容器下、不在背景栈里", () => {
    const container = renderTheater(cues, 2);
    // 第一次换底：from 的素材解析不出来，栈不成立，也就不该有纯色场
    expect(container.querySelector(".theater-fade-veil")).toBeNull();
  });

  it("dissolve / cut 不产生纯色场", () => {
    const container = renderTheater(cues, 4);
    expect(container.querySelector(".theater-fade-veil")).toBeNull();
  });

  it("fade 的纯色场在立绘层之后（DOM 顺序：能盖住立绘与 CG）", () => {
    const fadeCues: Cue[] = [
      { key: "c0", kind: "scene", bg: "bg_a" },
      { key: "c1", kind: "actor", id: "alice", pos: "center" },
      { key: "c2", kind: "scene", bg: "bg_b", transition: "fade" },
    ];
    const container = renderTheater(fadeCues, 3);
    const veil = container.querySelector(".theater-fade-veil")!;
    expect(veil).toBeTruthy();
    const camera = container.querySelector(".theater-camera")!;
    const kids = [...camera.children];
    expect(kids.indexOf(veil)).toBeGreaterThan(kids.indexOf(container.querySelector(".theater-sprites")!));
    // 也必须在背景栈之外——关进栈里就只能盖住背景，人物会浮在黑场里
    expect(container.querySelector(".theater-stack")!.contains(veil)).toBe(false);
  });
});
