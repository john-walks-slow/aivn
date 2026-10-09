import type { FieldMap, InferArgs } from "../schema/ir.js";

/**
 * 一份能力 = 一个领域动作的完整定义：参数规格（`fields`）+ 文档（`doc`）+ 实现（`execute`）。
 *
 * 这里**没有**工具名、角色、能力位、同步还是排产、直落还是草稿——那些是宿主的 face
 * （工具面是产品，能力是实现）。宿主拿到能力后做三件事：
 *
 * 1. `pick` 出这个 face 露出的字段、按需 `tighten`；
 * 2. 编译成自己的 SDK 认的 schema；
 * 3. 用自己的输出包装（pi 的 `textResult` / dsh 的 `ContentBlock`）把 `execute` 的返回值端给模型。
 */
export interface Capability<F extends FieldMap, Deps, Out> {
  /** 领域动作的稳定标识（如 `web.search`），用来查表、排序、生成契约。 */
  readonly id: string;
  /** 参数真相源。 */
  readonly fields: F;
  /** 工具描述正文（`DESCRIPTION`）——唯一真相源，宿主不得再写一份。 */
  readonly doc: string;
  execute(args: InferArgs<F>, deps: Deps): Promise<Out>;
}
