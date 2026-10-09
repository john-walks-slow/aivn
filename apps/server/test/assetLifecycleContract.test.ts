import { describe, expect, it } from "vitest";
import { canTransitionAsset, type AssetLifecycleState } from "@aivn/core";

/**
 * 生命周期的**边界对账**：上一条用例按契约自己的语义断言，这一条从「实现真实走的路径」
 * 反向检查契约接不接得住。两边分开写是有意的——同一条表自己跟自己对，接不住真实路径
 * 的错也测不出来（`draft → adopted` 正是这么漏的：独立版工坊一直走这条，契约第一版
 * 只写了 `pending → adopted`）。
 */
describe("素材生命周期：实现真实路径与契约的边界", () => {
  /** 让每条断言自带一句说明，读失败信息就知道是哪条路径没接住。 */
  const step = (from: AssetLifecycleState | null, to: AssetLifecycleState, why: string) => {
    expect(canTransitionAsset(from, to), `${why}（${from ?? "无"} → ${to}）`).toBe(true);
  };

  it("独立版工坊的同步出图：没有 pending，草稿采用是 draft → adopted", () => {
    step(null, "draft", "generate_image(sync) 直接产草稿");
    step("draft", "adopted", "commit_asset 采用草稿");
  });

  it("独立版剧作家的后台排产：pending → adopted（draft + commit 一次做完）", () => {
    step(null, "pending", "queued 出图受理");
    step("pending", "adopted", "到货即入库，中间不暴露草稿态");
  });

  it("DSH 的同步与一键入库两条路都接得住", () => {
    step(null, "draft", "generate_image 只产候选");
    step("draft", "adopted", "commit 采用候选");
  });

  it("生成失败在任何受理路径上都留得住错因", () => {
    step("pending", "failed", "后台排产失败");
  });

  it("没被采用的候选只走过期，不走否决", () => {
    step(null, "draft", "候选产出");
    step("draft", "expired", "保留期到了被清理");
    // 用户「没有选」在界面上不是一个动作，不该有对应的状态迁移。
    expect(canTransitionAsset("draft", "rejected" as AssetLifecycleState)).toBe(false);
  });
});
