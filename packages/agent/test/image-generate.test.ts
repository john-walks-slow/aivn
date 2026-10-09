import { describe, expect, it } from "vitest";
import {
  imageGenerate,
  imageGenerateFields,
  imageTargetOf,
  IMAGE_GENERATE_DOC,
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
  resolveImageRefs,
} from "../src/capabilities/image/generate.js";
import { assertCommonSubset } from "../src/schema/ir.js";

describe("image.generate", () => {
  it("共享字段只用共同子集（宿主专有的长度/范围收紧写在各自的 face 上）", () => {
    expect(() => assertCommonSubset(imageGenerateFields, "image.generate")).not.toThrow();
  });

  it("产物说明里带着写 prompt 的硬约束与垫图规则——它们只在包里有", () => {
    expect(IMAGE_GENERATE_DOC).toContain(IMAGE_PROMPT_RULES);
    expect(IMAGE_GENERATE_DOC).toContain(IMAGE_REFERENCE_RULE);
    expect(IMAGE_PROMPT_RULES).toContain("逐条带上角色卡的外貌");
    expect(IMAGE_REFERENCE_RULE).toContain("非 neutral 的立绘差分不吃 references");
  });

  it("两个参考图参数合并去重、修边、封顶 6 张", () => {
    expect(resolveImageRefs({})).toBeUndefined();
    expect(resolveImageRefs({ references: [" mio ", "mio", ""], referenceCharacters: ["rin", "mio"] })).toEqual([
      "mio",
      "rin",
    ]);
    const many = Array.from({ length: 8 }, (_, i) => `r${i}`);
    expect(resolveImageRefs({ references: many })).toHaveLength(6);
  });

  it("落位归一化：立绘要主体 id、背景/CG 要素材 id，缺了当场拒", () => {
    expect(imageTargetOf({ kind: "sprite", spriteId: " mio ", variant: " smile ", title: " 澪 " })).toEqual({
      kind: "sprite",
      spriteId: "mio",
      variant: "smile",
      title: "澪",
    });
    expect(imageTargetOf({ kind: "sprite", spriteId: "mio" })).toMatchObject({ variant: "neutral" });
    expect(imageTargetOf({ kind: "cg", name: " cg_01 " })).toEqual({ kind: "cg", name: "cg_01" });
    expect(() => imageTargetOf({ kind: "sprite" })).toThrow(/spriteId/);
    expect(() => imageTargetOf({ kind: "background" })).toThrow(/name/);
  });

  it("execute 只把参数收成请求，出图与落库交给宿主的 run（同步/排产/一条龙都是这一格）", async () => {
    const seen: unknown[] = [];
    const text = await imageGenerate.execute(
      { kind: "sprite", spriteId: "mio", prompt: "  a girl ", style: " 赛璐珞 ", references: ["rin"] },
      { run: async (request) => { seen.push(request); return "已入库"; } },
    );
    expect(seen).toEqual([
      { target: { kind: "sprite", spriteId: "mio", variant: "neutral" }, prompt: "  a girl ", style: "赛璐珞", references: ["rin"] },
    ]);
    expect(text).toBe("已入库");
  });
});
