import type { Readiness } from "../store.js";

/** 开演条件渲染（工坊提示词的「当前状态」章节与 get_readiness 工具共用一份）。 */
export function renderReadiness(r: Readiness): string {
  return [
    "开演条件：没有硬门槛，缺什么都能开演。",
    `- 故事前提：${r.premise ? "✓" : "缺（memory/always/premise.md）——不写也行，剧作家会自由发挥"}`,
    `- 立绘：${r.sprites ? "✓" : "缺（建议补）"}`,
    `- 背景图：${r.background ? "✓" : "缺（建议补）"}`,
    "（缺项不是门槛：没有图也能开演，演出时落氛围底色、没有立绘的角色不上台）",
  ].join("\n");
}
