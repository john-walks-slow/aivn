import {
  CRAFT_ENUMS,
  describeCraftParams,
  renderCraftParams as renderCraft,
  type AssetCapabilities,
} from "@aivn/agent";
import type { CraftStopOptions, EffectiveCraft } from "@aivn/core";

export { resolveCraft } from "@aivn/core";
export { CRAFT_ENUMS, describeCraftParams };
export type { AssetCapabilities };

/**
 * 写作参数（`craft`）。
 *
 * 两份说法（给剧作家的「该怎么写」、给工坊的「现在是什么」）与取值白名单都在
 * `@aivn/agent` 的 `craft/params.ts`（与 DSH 插件共用一份）；本文件只留**停止点的措辞**：
 * 两个宿主都把停止点写进剧本最后一行 `<stop options="…"/>`（2026-10-10 起统一），
 * 同一件事两种表达，这是有意的差异。
 */

/**
 * 「**有**停止点时给几条」而不是「每次给几条」：什么时候交还主导权归剧作家自己判断（那是创作口径），
 * 这一条只定「给了就是几条」。写成「每次给」会让它每轮都硬塞一组选项，narrative 再也收不了尾。
 */
const STOP_OPTIONS_DIRECTIVE: Record<CraftStopOptions, string> = {
  two: '有停止点时给 2 条互斥选项：<stop options="… | …"/>。',
  three: '有停止点时给 3 条互斥选项：<stop options="… | … | …"/>。',
  four: '有停止点时给 4 条互斥选项：<stop options="… | … | … | …"/>。',
  free: '固定停在自由输入框：<stop placeholder="…"/>，不给 options。',
};

/**
 * 剧作家提示词里的「写作参数」段。
 *
 * **永远注入**（包括全默认值时）：缺省口径也得说出来，否则模型面对的是「没人告诉它一轮写多长」——
 * 而它每一轮都在做这个决定，做出来的东西和用户以为的默认值对不上时，用户改哪个开关都没用。
 *
 * 注入位置紧挨 `memory/always/craft.md` 之前：先给确定的三条参数（多长、几个选项、素材从哪来），
 * 再读那份散文口径（文风、禁忌、称呼），读完正好开写。
 */
export function renderCraftParams(craft: EffectiveCraft, can: AssetCapabilities): string {
  return renderCraft(craft, can, (options) => STOP_OPTIONS_DIRECTIVE[options]);
}
