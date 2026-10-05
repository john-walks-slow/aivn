// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePlayback, type Cue, type ScriptLine, type TranscriptEntry } from "@aivn/stage";

/** 一次真实形状的缓冲：换景 → 独白 → 小优进场 → 台词 → 退场 → 收尾。 */
const cues: Cue[] = [
  { key: "c0", kind: "scene", bg: "bg_hall" },
  { key: "c1", kind: "line", lineKey: "l1" },
  { key: "c2", kind: "actor", id: "yu", pos: "center" },
  { key: "c3", kind: "line", lineKey: "l2" },
  { key: "c4", kind: "actor", id: "yu", leave: "1" },
  { key: "c5", kind: "line", lineKey: "l3" },
];

const lines: ScriptLine[] = [
  { key: "l1", type: "narrate", text: "放学后的走廊空无一人。" },
  { key: "l2", type: "say", actorId: "yu", text: "……太慢了！" },
  { key: "l3", type: "say", actorId: "yu", text: "算了，走吧。" },
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

/** 演出到底：turbo 档让每句一次读完，advance 一次就消费到下一句台词。 */
function playToEnd() {
  const hook = renderHook(() =>
    usePlayback(cues, lines, { live: false, resume: false, revision: 1, transcript, turbo: true }),
  );
  for (let i = 0; i < 3; i += 1) act(() => hook.result.current.advance());
  return hook;
}

describe("回看时舞台画面跟着回到那一刻", () => {
  it("折回那一句：退场的人重新在场，还没登场的人不在", () => {
    const { result } = playToEnd();
    // 现场：小优已退场（留在表里只为把淡出播完）
    expect(result.current.visual.sprites.yu?.leaving).toBe(true);
    expect(result.current.visual.bg).toBe("bg_hall");

    act(() => result.current.scrub(-1)); // 回到第二句：她刚登场、还没退场
    expect(result.current.scrubbed).toBe(true);
    expect(result.current.visual.sprites.yu?.leaving).toBe(false);
    expect(result.current.visual.bg).toBe("bg_hall");

    act(() => result.current.scrub(-1)); // 回到第一句：她还没登场
    expect(result.current.visual.sprites).toEqual({});
  });

  it("松手回到播放头：现场一个字节没动，不需要任何还原", () => {
    const { result } = playToEnd();
    act(() => result.current.scrub(-1));
    act(() => result.current.follow());
    expect(result.current.scrubbed).toBe(false);
    expect(result.current.visual.sprites.yu?.leaving).toBe(true);
  });
});
