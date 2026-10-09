import type { FieldMap } from "../../schema/ir.js";
import type { Capability } from "../capability.js";
import { renderReadiness, type PlayReadiness } from "../../readiness/play.js";

/**
 * `play.readiness` —— 报「这座剧目读不读得出来、还缺什么」（agent 面自查）。
 *
 * 两个宿主同一份判据与同一份报告文本：剧目文件是模型自己用文件工具写的，「写得对不对」得有地方问。
 * 它报的是**底数，不是闸门**——缺什么都能开演。
 *
 * 面板 / 剧目卡那份底数（周目数、前提、立绘与背景的概览）是另一个读者（用户），不走这里。
 */

/** 没有参数：自查不需要问任何东西（空 `FieldMap`，两边的 face 都是空对象）。 */
export const playReadinessFields = {} as const satisfies FieldMap;

export const PLAY_READINESS_DOC = [
  "检查这座剧目：`play.json` 读不读得出来（缺字段 / 坏 JSON / 值不合法会给原因）、`craft` 里的取值引擎认不认、",
  "状态文件好不好、故事前提、角色卡张数、立绘、背景、素材条数，以及出图台账里有没有指向不存在文件的登记。",
  "刚写过 `play.json`、角色卡，或改了剧目结构之后调它——报出来的错误与缺项就是接下来该修的东西。",
  "**没有硬门槛**：缺什么都能开演。",
].join("\n");

/** 宿主那侧只接「这座剧目现在什么样」（同步读盘，判据在包里）。 */
export interface PlayReadinessDeps {
  read(): PlayReadiness;
}

export const playReadiness: Capability<typeof playReadinessFields, PlayReadinessDeps, string> = {
  id: "play.readiness",
  fields: playReadinessFields,
  doc: PLAY_READINESS_DOC,
  async execute(_args, deps) {
    return renderReadiness(deps.read());
  },
};
