import { describe, expect, it } from "vitest";
import { assertCommonSubset, pick, tighten, type FieldMap, type InferArgs } from "../src/index.js";

const fields = {
  query: { type: "string", required: true, description: "查什么" },
  numResults: { type: "integer", description: "几条" },
  tags: { type: "array", items: { type: "string" } },
  mode: { type: "string", enum: ["fast", "deep"] },
  exact: { type: "string", const: "只此一种" },
  nested: { type: "object", properties: { note: { type: "string", required: true } }, additionalProperties: false },
  either: { oneOf: [{ type: "string" }, { type: "number" }] },
  loose: { type: "json" },
} as const satisfies FieldMap;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/** 参数类型从 fields 反推：必填键必填，其余可选，枚举/const/oneOf 都收窄。 */
type _Args = Expect<
  Equal<
    InferArgs<typeof fields>,
    {
      query: string;
      numResults?: number;
      tags?: unknown[];
      mode?: "fast" | "deep";
      exact?: "只此一种";
      nested?: Record<string, unknown>;
      either?: string | number;
      loose?: unknown;
    }
  >
>;

describe("schema IR", () => {
  it("pick 只留 face 露出的那几格，且不复制节点", () => {
    const picked = pick(fields, ["query", "numResults"]);
    expect(Object.keys(picked)).toEqual(["query", "numResults"]);
    expect(picked.query).toBe(fields.query);
  });

  it("tighten 把宿主认得的约束叠上去，不动原节点", () => {
    const host = tighten(pick(fields, ["query"]), { query: { minLength: 1, maxLength: 400 } });
    expect(host.query).toMatchObject({ type: "string", required: true, minLength: 1, maxLength: 400 });
    // 原节点是共享字段，不该被宿主污染
    expect(fields.query).not.toHaveProperty("maxLength");
  });

  it("共同子集断言：共享字段里出现宿主专有关键字就当场失败，且指得出路径", () => {
    expect(() => assertCommonSubset(fields, "demo")).not.toThrow();
    const dirty = { query: { type: "string", maxLength: 400 } } as unknown as FieldMap;
    expect(() => assertCommonSubset(dirty, "demo")).toThrow(/demo\.query 用了宿主专有关键字 maxLength/);
    const nested = { box: { type: "object", properties: dirty } } as unknown as FieldMap;
    expect(() => assertCommonSubset(nested, "demo")).toThrow(/demo\.box\.query/);
    const union = { either: { oneOf: [{ type: "string", minLength: 1 }, { type: "number" }] } } as unknown as FieldMap;
    expect(() => assertCommonSubset(union, "demo")).toThrow(/demo\.either 用了宿主专有关键字 minLength/);
  });
});

/** 类型层面的判据：上面那个 `_Args` 只有真相等才编译得过。 */
const _typeCheck: _Args = true;
void _typeCheck;
