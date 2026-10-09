import { StringEnum, Type, type TSchema } from "@earendil-works/pi-ai";
import type { HostFieldMap, HostTightening, SchemaNode } from "@aivn/agent";

/**
 * 中立 IR → TypeBox：**宿主自己的编译器**。
 *
 * 编译器住在宿主里，因为这一步需要宿主的 SDK——包不认识 TypeBox，也不认识 dsh-tools（规约 R5）。
 * 换来的好处是两边共用同一份参数真相源：字段的形状、约束、说明只写在能力里，宿主只负责翻译。
 *
 * 宿主专有的收紧（`minLength` / `maximum` 这类 pi 运行时硬认、DSH 侧不认的关键字）由 face 用
 * `tighten` 叠上来，所以这个编译器认的输入是 `HostFieldMap`。
 */
type PiNode = SchemaNode & HostTightening;

/** 编译一个 face 的参数面：闭口对象（`additionalProperties: false`，与原先手写的写法一致）。 */
export function toPi(fields: HostFieldMap): TSchema {
  const properties: Record<string, TSchema> = {};
  for (const [name, field] of Object.entries(fields)) {
    const node = toPiNode(field);
    properties[name] = field.required === true ? node : Type.Optional(node);
  }
  return Type.Object(properties, { additionalProperties: false });
}

function toPiNode(node: PiNode): TSchema {
  const annotations = {
    ...(node.description !== undefined ? { description: node.description } : {}),
    ...(node.title !== undefined ? { title: node.title } : {}),
  };
  if ("oneOf" in node) return Type.Union(node.oneOf.map(toPiNode));
  switch (node.type) {
    case "string":
      if (node.const !== undefined) return Type.Literal(node.const);
      // 字符串枚举走 pi 的 StringEnum：它直接写 `enum` 关键字，避开部分 provider 不认 anyOf/const 的坑。
      if (node.enum) return StringEnum(node.enum, annotations);
      return Type.String({
        ...annotations,
        ...(node.minLength !== undefined ? { minLength: node.minLength } : {}),
        ...(node.maxLength !== undefined ? { maxLength: node.maxLength } : {}),
      });
    case "integer":
      return literalNode(node) ?? Type.Integer({ ...annotations, ...bounds(node) });
    case "number":
      return literalNode(node) ?? Type.Number({ ...annotations, ...bounds(node) });
    case "boolean":
      return node.const !== undefined ? Type.Literal(node.const) : Type.Boolean(annotations);
    case "array":
      return Type.Array(node.items ? toPiNode(node.items) : Type.Unknown(), annotations);
    case "object":
      return Type.Object(
        Object.fromEntries(Object.entries(node.properties).map(([name, field]) => [name, toPiNode(field)])),
        { ...annotations, additionalProperties: node.additionalProperties ?? true },
      );
    case "json":
      return Type.Unknown(annotations);
  }
}

function bounds(node: PiNode): Record<string, unknown> {
  return {
    ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
    ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
  };
}

/** 数字的枚举/字面量统一走 `Type.Literal` 的联合——TypeBox 的数值选项里没有 `enum`/`const`。 */
function literalNode(node: PiNode): TSchema | undefined {
  if ("const" in node && node.const !== undefined) return Type.Literal(node.const);
  if (!("enum" in node) || !node.enum) return undefined;
  const literals = node.enum.map((value) => Type.Literal(value));
  return literals.length === 1 ? literals[0]! : Type.Union(literals);
}
