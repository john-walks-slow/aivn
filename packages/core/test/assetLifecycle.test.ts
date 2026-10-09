import { describe, expect, it } from "vitest";
import {
  ASSET_DRAFT_RETENTION_DAYS,
  ASSET_LIFECYCLE_STATES,
  ASSET_LIFECYCLE_TRANSITIONS,
  canTransitionAsset,
  isAssetReferencable,
  isTerminalAssetState,
} from "../src/play/assetLifecycle.js";

describe("素材生命周期契约", () => {
  it("转换表的每一项都引用合法状态，且没有重复边", () => {
    const known = new Set<string>(ASSET_LIFECYCLE_STATES);
    const seen = new Set<string>();
    for (const transition of ASSET_LIFECYCLE_TRANSITIONS) {
      if (transition.from !== null) expect(known.has(transition.from), `未知起点 ${transition.from}`).toBe(true);
      expect(known.has(transition.to), `未知终点 ${transition.to}`).toBe(true);
      const key = `${transition.from ?? ""}>${transition.to}`;
      expect(seen.has(key), `重复的转换 ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("正常路径：受理 → 候选 → 采用", () => {
    expect(canTransitionAsset(null, "pending")).toBe(true);
    expect(canTransitionAsset("pending", "draft")).toBe(true);
    expect(canTransitionAsset("draft", "adopted")).toBe(true);
  });

  it("同步出图跳过 pending，直接从没有到草稿", () => {
    expect(canTransitionAsset(null, "draft")).toBe(true);
  });

  it("重复采用是合法的幂等边，不是错误", () => {
    expect(canTransitionAsset("adopted", "adopted")).toBe(true);
  });

  it("生成失败留住错因，且失败只能从 pending 来", () => {
    expect(canTransitionAsset("pending", "failed")).toBe(true);
    expect(canTransitionAsset("draft", "failed")).toBe(false);
    expect(canTransitionAsset("adopted", "failed")).toBe(false);
  });

  it("过期只在草稿区发生——入库的素材不会自己过期", () => {
    expect(canTransitionAsset("draft", "expired")).toBe(true);
    expect(canTransitionAsset("adopted", "expired")).toBe(false);
  });

  it("没有 rejected 这条边：没被挑中不是被否决", () => {
    // 契约里根本没有这个状态，所以任何指向它的转换都不合法——这条测试是防止有人
    // 为了「对称」把 rejected 加回来，从而给每个候选强加一次显式否决。
    expect((ASSET_LIFECYCLE_STATES as readonly string[]).includes("rejected")).toBe(false);
    for (const state of ASSET_LIFECYCLE_STATES) {
      expect(canTransitionAsset(state, "rejected" as never)).toBe(false);
    }
  });

  it("草稿不能自己变成草稿：再出一张候选是新的一份", () => {
    expect(canTransitionAsset("draft", "draft")).toBe(false);
  });

  it("终态与可引用性", () => {
    expect(isTerminalAssetState("adopted")).toBe(true);
    expect(isTerminalAssetState("failed")).toBe(true);
    expect(isTerminalAssetState("expired")).toBe(true);
    expect(isTerminalAssetState("draft")).toBe(false);
    expect(isTerminalAssetState("pending")).toBe(false);

    // 只有进了素材表的东西能被剧本引用；草稿摆在对话里好看，但引用不到。
    expect(isAssetReferencable("adopted")).toBe(true);
    for (const state of ["pending", "draft", "expired", "failed"] as const) {
      expect(isAssetReferencable(state)).toBe(false);
    }
  });

  it("保留期是对用户承诺的同一个天数", () => {
    expect(ASSET_DRAFT_RETENTION_DAYS).toBe(7);
  });
});
