/**
 * 中立 schema IR —— 能力声明的**参数真相源**。
 *
 * 一份能力只写一遍参数的形状、约束与说明；两个宿主各自把这份 IR 编译成自己 SDK 吃得下的
 * 东西（服务端 → TypeBox，DSH 插件 → dsh-tools 的 `ParameterSchemaSpec`）。编译器住在宿主里，
 * 因为那需要宿主的 SDK——包不认识 TypeBox，也不认识 dsh-tools（规约 R5）。
 *
 * 由此推出一条硬规矩：**共享字段只能落在两个宿主都表达得出的共同子集里**。
 * `minLength` / `maximum` 这类只有 pi 的校验器认得的约束不进共享字段（`assertCommonSubset`
 * 会拦），确实想要的宿主把它写在自己的 **face** 上（`tighten`）——face 是宿主自己的声明，
 * 不属于能力。
 *
 * 为什么不是「取交集后两边都退化成最弱」：pi 的校验是运行时硬校验，退掉它等于把参数错误
 * 从「工具当场拒绝」变成「实现里再判一次」。
 */

/** 注解：每个节点都能带。 */
interface Annotations {
  readonly description?: string;
  readonly title?: string;
}

export interface StringNode extends Annotations {
  readonly type: "string";
  readonly enum?: readonly string[];
  readonly const?: string;
}

export interface NumberNode extends Annotations {
  readonly type: "number";
  readonly enum?: readonly number[];
  readonly const?: number;
}

export interface IntegerNode extends Annotations {
  readonly type: "integer";
  readonly enum?: readonly number[];
  readonly const?: number;
}

export interface BooleanNode extends Annotations {
  readonly type: "boolean";
  readonly enum?: readonly boolean[];
  readonly const?: boolean;
}

/** 无约束的 JSON 值（宿主各自映射成自己的 `unknown`）。 */
export interface JsonNode extends Annotations {
  readonly type: "json";
}

export interface ArrayNode extends Annotations {
  readonly type: "array";
  readonly items?: SchemaNode;
}

export interface ObjectNode extends Annotations {
  readonly type: "object";
  readonly properties: FieldMap;
  /** 缺省 = 按 JSON Schema 的开放默认；要拒绝未声明键就写 false。 */
  readonly additionalProperties?: boolean;
}

/** 恰取一支的联合。至少两支。 */
export interface OneOfNode extends Annotations {
  readonly oneOf: readonly [SchemaNode, SchemaNode, ...SchemaNode[]];
}

export type SchemaNode =
  | StringNode
  | NumberNode
  | IntegerNode
  | BooleanNode
  | JsonNode
  | ArrayNode
  | ObjectNode
  | OneOfNode;

/** 参数根上的一格：`required: true` 即必填（缺省可选）。 */
export type Field = SchemaNode & { readonly required?: true };

export type FieldMap = { readonly [name: string]: Field };

/** 节点值的类型推演：参数类型从 `fields` 反推，不再手抄一份 `Args` 接口。 */
export type InferValue<N> = N extends { readonly oneOf: readonly (infer Branch)[] }
  ? InferValue<Branch>
  : N extends { readonly const: infer Literal }
    ? Literal
    : N extends { readonly enum: readonly (infer Member)[] }
      ? Member
      : N extends { readonly type: "string" }
        ? string
        : N extends { readonly type: "number" | "integer" }
          ? number
          : N extends { readonly type: "boolean" }
            ? boolean
            : N extends { readonly type: "array" }
              ? unknown[]
              : N extends { readonly type: "object" }
                ? Record<string, unknown>
                : N extends { readonly type: "json" }
                  ? unknown
                  : never;

type RequiredKeys<F> = {
  [K in keyof F]: F[K] extends { readonly required: true } ? K : never;
}[keyof F];

type OptionalKeys<F> = Exclude<keyof F, RequiredKeys<F>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** 参数对象的类型：必填键必填，其余可选。 */
export type InferArgs<F extends FieldMap> = Simplify<
  { [K in RequiredKeys<F>]: InferValue<F[K]> } & { [K in OptionalKeys<F>]?: InferValue<F[K]> }
>;

/**
 * 宿主专有的**收紧**：共同子集之外的校验关键字。
 * 只有认得它的宿主能声明（服务端 pi 运行时认，DSH 的 schema 子集会当场拒绝）。
 */
export interface HostTightening {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export type HostField = Field & HostTightening;
export type HostFieldMap = { readonly [name: string]: HostField };

/** face 的 pick：露出哪几格由 face 声明，文案与类型仍只有能力那一份。 */
export function pick<F extends FieldMap, const K extends readonly (keyof F)[]>(
  fields: F,
  keys: K,
): Pick<F, K[number]> {
  const out: Record<string, Field> = {};
  for (const key of keys) out[key as string] = fields[key]!;
  return out as Pick<F, K[number]>;
}

/** face 的收紧：把宿主认得的约束叠在被 pick 出来的字段上。 */
export function tighten<F extends FieldMap>(
  fields: F,
  overrides: { readonly [K in keyof F]?: HostTightening },
): HostFieldMap {
  const source = fields as FieldMap;
  const out: Record<string, HostField> = {};
  for (const key of Object.keys(source)) {
    out[key] = { ...source[key]!, ...overrides[key as keyof F] };
  }
  return out;
}

const HOST_ONLY_KEYWORDS = ["minLength", "maxLength", "minimum", "maximum"] as const;

/**
 * 共享字段必须落在共同子集里。包单测把每份能力的 fields 都过一遍这里——
 * 违规要在**包测试**里当场失败，而不是等插件注册工具时才炸。
 */
export function assertCommonSubset(fields: FieldMap, where: string): void {
  for (const [name, node] of Object.entries(fields)) walk(node, `${where}.${name}`);
}

function walk(node: SchemaNode, path: string): void {
  for (const keyword of HOST_ONLY_KEYWORDS) {
    if (keyword in node) throw new Error(`${path} 用了宿主专有关键字 ${keyword}：共享字段只能用共同子集`);
  }
  if ("properties" in node) assertCommonSubset(node.properties, path);
  if ("items" in node && node.items) walk(node.items, `${path}[]`);
  if ("oneOf" in node) for (const branch of node.oneOf) walk(branch, path);
}
