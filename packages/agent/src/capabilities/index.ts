import type { FieldMap } from "../schema/ir.js";
import { webSearch } from "./web/search.js";

/** 能力表要能装下任意能力，而各能力的 `execute` 签名互不相同——查表只关心这三样。 */
export interface CapabilityEntry {
  readonly id: string;
  readonly fields: FieldMap;
  readonly doc: string;
}

/**
 * 包内能力表：宿主的契约（能力矩阵、工具面覆盖检查）从这里**派生**，不再手抄一份。
 * 新能力加进来时，这条清单是唯一要动的地方。
 */
export const CAPABILITIES: readonly CapabilityEntry[] = [webSearch];
