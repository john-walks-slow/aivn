// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { StopPayload } from "@aivn/core";
import {
  usePlayback,
  type AssetIndex,
  type Cue,
  type ScriptLine,
  type TranscriptEntry,
  StageTheater,
  StopPanel,
} from "@aivn/stage";

// jsdom 没有 ResizeObserver；舞台靠它把两块浮层的实测高度写回 CSS 变量。
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const cues: Cue[] = [{ key: "c0", kind: "line", lineKey: "l1" }];
const lines: ScriptLine[] = [{ key: "l1", type: "narrate", text: "走廊空无一人。" }];
const transcript: TranscriptEntry[] = [
  {
    key: "l1",
    kind: "line",
    type: "narrate",
    actorId: null,
    text: "走廊空无一人。",
    seq: null,
    nodeId: "n_l1",
  },
];

const index: AssetIndex = {
  bg: () => null,
  cg: () => null,
  bgm: () => null,
  sfx: () => null,
  ambient: () => null,
  spriteDirOf: (actorId) => actorId,
  spriteName: () => null,
  sprite: () => null,
  spriteIds: [],
  spritePresentation: () => ({ framing: "full", stature: "normal", anchor: "bottom" }),
};

function Theater({
  directorBar,
  live = false,
  dialogStatus,
}: {
  directorBar?: boolean;
  live?: boolean;
  dialogStatus?: ReactNode;
}) {
  const playback = usePlayback(cues, lines, { live: false, resume: false, revision: 1, transcript });
  return (
    <StageTheater
      visual={playback.visual}
      playback={playback}
      live={live}
      names={{}}
      index={index}
      voiceAvailable={false}
      voiceOn={false}
      onToggleVoice={() => {}}
      busy={false}
      targets={{ beatId: null, beatNodeId: null, lineNodeId: null, lineSeq: null, lineText: "" }}
      onPrompt={() => {}}
      onEdit={() => {}}
      onFork={() => {}}
      onGenerateCg={() => {}}
      onReplay={() => {}}
      voiceState={() => "none"}
      onUnlock={() => {}}
      onView={() => {}}
      canContinue={false}
      onContinue={() => {}}
      onTurbo={() => {}}
      {...(directorBar === undefined ? {} : { directorBar })}
      {...(dialogStatus === undefined ? {} : { dialogStatus })}
    />
  );
}

const FREE_STOP: StopPayload = { stopType: "free", placeholder: "你的回应…" };

function Panel({ onPolish }: { onPolish?: (text: string) => Promise<string> }) {
  return (
    <StopPanel
      stop={FREE_STOP}
      isNoStop={false}
      disabled={false}
      onChoice={() => {}}
      onFree={() => {}}
      {...(onPolish ? { onPolish } : {})}
    />
  );
}

/** 自由输入的模态窗要从列表里那张卡点开。 */
function openFreeInput(): void {
  fireEvent.click(screen.getByTitle("不说选项，以主角口吻自己写一句"));
}

afterEach(cleanup);

/**
 * 宿主扩展位：没有落点的宿主（DSH 插件）关掉导演栏、不给润色接口时，
 * 拿到的必须是「没有那一块」的渲染形态，而不是一块点不动的空壳。
 */
describe("宿主扩展位", () => {
  it("directorBar 缺省渲染导演栏，并把 --dir-h 写成实测高度", () => {
    const { container } = render(<Theater />);
    expect(container.querySelector(".theater-director")).toBeTruthy();
    const theater = container.querySelector(".theater") as HTMLElement;
    expect(theater.classList.contains("stage-root")).toBe(true);
  });

  it("directorBar=false 时导演栏整块不渲染，--dir-h 写回 0px", () => {
    const { container } = render(<Theater directorBar={false} />);
    expect(container.querySelector(".theater-director")).toBeNull();
    const theater = container.querySelector(".theater") as HTMLElement;
    // CSS 缺省值是 46px；不写回 0 的话选肢层底部会凭空多出一条缝
    expect(theater.style.getPropertyValue("--dir-h")).toBe("0px");
  });

  it("dialogStatus 顶掉内置 spinner：同一件事（剧作家正在写）不摆两遍", () => {
    const { container, rerender } = render(
      <Theater live dialogStatus={<button className="prompt-queue-badge">剧作家创作中</button>} />,
    );
    expect(container.querySelector(".dialog-hint-foot .prompt-queue-badge")).toBeTruthy();
    expect(container.querySelector(".dialog-spinner")).toBeNull();

    // 手里没有待注入队列的宿主（dsh-aivn）不传槽位，照旧是 spinner
    rerender(<Theater live />);
    expect(container.querySelector(".dialog-hint-foot .dialog-spinner")).toBeTruthy();

    // 宿主自己那枚没东西可报时不摆（传 null），这格照样得还给 spinner
    rerender(<Theater live dialogStatus={null} />);
    expect(container.querySelector(".dialog-hint-foot .dialog-spinner")).toBeTruthy();
  });

  it("浏览器没有全屏能力时，右下角不摆那枚按不动的全屏键", () => {
    // jsdom 的 documentElement 上没有 requestFullscreen：这正是能力检测要挡的那一档
    render(<Theater />);
    expect(document.documentElement.requestFullscreen).toBeUndefined();
    expect(screen.queryByLabelText("进入全屏")).toBeNull();
  });

  it("有全屏能力时它在快照里有落点，点它就去全屏", () => {
    const requested: string[] = [];
    (document.documentElement as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen =
      () => {
        requested.push("doc");
        return Promise.resolve();
      };
    try {
      render(<Theater />);
      fireEvent.click(screen.getByLabelText("进入全屏"));
      expect(requested).toEqual(["doc"]);
    } finally {
      delete (document.documentElement as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });

  it("不传 onPolish 时没有润色按钮（也没有撤销）", () => {
    render(<Panel />);
    openFreeInput();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByTitle("LLM 按主角口吻润色（可撤销）")).toBeNull();
  });

  it("传了 onPolish 时润色按钮在，且润色走的就是它", async () => {
    const polish = (text: string): Promise<string> => Promise.resolve(`润色：${text}`);
    render(<Panel onPolish={polish} />);
    openFreeInput();
    const input = screen.getByPlaceholderText("你的回应…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "我先走了。" } });
    fireEvent.click(screen.getByTitle("LLM 按主角口吻润色（可撤销）"));
    await screen.findByDisplayValue("润色：我先走了。");
  });
});
