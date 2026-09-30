import type { Readiness } from "../store.js";

/** 开演条件渲染（工坊提示词的「当前状态」章节与 get_readiness 工具共用一份）。 */
export function renderReadiness(r: Readiness): string {
  return [
    `开演条件：${r.ready ? "已满足，可开演" : "未满足（缺故事前提）"}`,
    `- 故事前提：${r.premise ? "✓" : "✗ 缺（memory/always/premise.md）——这是唯一的硬门槛"}`,
    `- 角色立绘映射：${r.characterSprites ? "✓" : "缺（建议补）"}`,
    `- 背景图：${r.background ? "✓" : "缺（建议补）"}`,
    "（立绘与背景不是门槛：没有图也能开演，演出时落氛围底色、没有立绘的角色不上台）",
  ].join("\n");
}
