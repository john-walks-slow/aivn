import { describe, expect, it } from "vitest";
import { speakerFocusId, type SpriteSlot, type TranscriptEntry } from "@aivn/stage";

const slot: SpriteSlot = {
  resolvedPos: "center",
  expression: null,
  state: null,
  shot: null,
  anchor: "bottom",
  action: null,
  actionSeq: 0,
};

const entry = (partial: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  key: "k",
  kind: "line",
  type: "say",
  actorId: null,
  text: "",
  seq: 1,
  nodeId: null,
  ...partial,
});

describe("speakerFocusId：谁保持原亮度", () => {
  it("说话的人站在台上 → 聚焦他，别人压暗", () => {
    const sprites = { a: slot, b: slot };
    expect(speakerFocusId(entry({ actorId: "a" }), sprites)).toBe("a");
  });

  it("旁白没有发言人 → 整台原亮度", () => {
    expect(speakerFocusId(entry({ type: "narrate", actorId: null }), { a: slot, b: slot })).toBeNull();
  });

  it("没有当前行（空舞台 / 等待中）→ 整台原亮度", () => {
    expect(speakerFocusId(null, { a: slot })).toBeNull();
  });

  it("玩家输入挂的是 player，没有对应立绘 → 整台原亮度，而不是全场压暗", () => {
    expect(speakerFocusId(entry({ kind: "input", actorId: "player" }), { a: slot, b: slot })).toBeNull();
  });

  it("说话的人不在台上（一次性路人、还没登场）→ 整台原亮度", () => {
    expect(speakerFocusId(entry({ actorId: "passerby" }), { a: slot })).toBeNull();
  });
});
