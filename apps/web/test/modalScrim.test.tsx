// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  usePlayback,
  type Cue,
  type ScriptLine,
  type TranscriptEntry,
  StageTheater,
  type AssetIndex,
} from "@aivn/stage";

// jsdom 没有 ResizeObserver；舞台靠它把两块浮层的实测高度写回 CSS 变量。
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

const cues: Cue[] = [
  { key: "c0", kind: "line", lineKey: "l1" },
  { key: "c1", kind: "line", lineKey: "l2" },
];
const lines: ScriptLine[] = [
  { key: "l1", type: "narrate", text: "放学后的走廊空无一人。" },
  { key: "l2", type: "say", actorId: "yu", text: "……太慢了！" },
];
const transcript: TranscriptEntry[] = lines.map((line) => ({
  key: line.key,
  kind: "line",
  type: line.type === "say" ? "say" : "narrate",
  actorId: line.actorId ?? null,
  text: line.text,
  seq: null,
  nodeId: `n_${line.key}`,
}));

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

type Playback = ReturnType<typeof usePlayback>;

function Harness({
  canContinue,
  onContinue,
  latest,
}: {
  canContinue: boolean;
  onContinue: () => void;
  latest: { current: Playback | null };
}) {
  const playback = usePlayback(cues, lines, { live: false, resume: false, revision: 1, transcript });
  latest.current = playback;
  return (
    <StageTheater
      visual={playback.visual}
      playback={playback}
      live={false}
      names={{ yu: "小优" }}
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
      canContinue={canContinue}
      onContinue={onContinue}
      onTurbo={() => {}}
    />
  );
}

afterEach(cleanup);

function setup(canContinue: boolean) {
  const onContinue = vi.fn();
  const latest: { current: Playback | null } = { current: null };
  const utils = render(<Harness canContinue={canContinue} onContinue={onContinue} latest={latest} />);
  return { onContinue, latest, ...utils };
}

describe("弹窗遮罩点击不穿透到舞台", () => {
  it("点开提示再点遮罩：只关弹窗，不开新一轮", () => {
    const { onContinue } = setup(true);
    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("点开提示再点遮罩：不翻下一句", () => {
    const { latest } = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(latest.current?.current).toBeNull();
  });
});
