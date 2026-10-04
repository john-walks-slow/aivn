// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayback } from "../src/stage/director.js";
import type { Cue, ScriptLine } from "../src/stage/script.js";
import type { TranscriptEntry } from "../src/stage/transcript.js";
import { StageTheater } from "../src/stage/StageTheater.js";
import type { AssetIndex } from "../src/stage/assets.js";

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

/** 空索引：测试不关心画面，只关心按键落到哪个出口。 */
const index: AssetIndex = {
  bg: () => null,
  cg: () => null,
  bgm: () => null,
  sfx: () => null,
  ambient: () => null,
  sprite: () => null,
  spriteFraming: () => "full",
};

type Playback = ReturnType<typeof usePlayback>;

/**
 * 照 StageScreen 的接法把播放层与舞台拼起来：resume=false 让缓冲停在原地，
 * 于是「按键往前走了没有」能直接从播放头上读出来。
 */
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
      targets={{ beatId: null, lineNodeId: null, lineSeq: null, lineText: "" }}
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

function setup(canContinue: boolean) {  const onContinue = vi.fn();
  const latest: { current: Playback | null } = { current: null };
  const utils = render(<Harness canContinue={canContinue} onContinue={onContinue} latest={latest} />);
  return { onContinue, latest, ...utils };
}

describe("舞台的键盘出口", () => {
  it("停在停止点时按空格 = 点舞台继续生成", () => {
    const { onContinue } = setup(true);
    fireEvent.keyDown(window, { key: " " });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("不在停止点时按空格照旧往下翻一句", () => {
    const { onContinue, latest } = setup(false);
    expect(latest.current?.current).toBeNull();
    fireEvent.keyDown(window, { key: " " });
    expect(onContinue).not.toHaveBeenCalled();
    expect(latest.current?.current?.key).toBe("l1");
  });

  it("导演输入面板开着时，空格不越过浮层去开新一轮", () => {
    const { onContinue } = setup(true);
    fireEvent.click(screen.getByRole("button", { name: "提示" }));
    fireEvent.keyDown(window, { key: " " });
    expect(onContinue).not.toHaveBeenCalled();
  });
});
