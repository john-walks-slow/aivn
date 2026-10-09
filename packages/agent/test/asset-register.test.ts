import { describe, expect, it } from "vitest";
import { assetLocationOf, assetTargetFields } from "../src/capabilities/asset/target.js";
import { assetRegister, type AssetRegisterDeps } from "../src/capabilities/asset/register.js";

/** 假 IO：能力只认「读来源、落盘、记账」这一层，不碰文件系统。 */
function deps() {
  const calls: Array<{ source: string; location: unknown; extra: unknown }> = [];
  const fake: AssetRegisterDeps = {
    register: async (source, location, extra) => {
      calls.push({ source, location, extra });
      return { kind: location.kind, path: `assets/sprites/${location.spriteId}/${location.variant ?? "neutral"}.png`, replaced: false };
    },
  };
  return { calls, fake };
}

describe("落位归一化", () => {
  it("立绘：空串丢掉、trim 之后只留真正给了的字段（差分不给按 neutral）", () => {
    expect(
      assetLocationOf({ kind: "sprite", spriteId: " lin ", variant: "", title: " 小雨 " }),
    ).toEqual({ kind: "sprite", spriteId: "lin", variant: "neutral", title: "小雨" });
    expect(assetLocationOf({ kind: "background", name: " rooftop " })).toEqual({ kind: "background", name: "rooftop" });
  });

  it("背景与插图要 name、立绘要 spriteId，否则当场拒绝", () => {
    expect(() => assetLocationOf({ kind: "background" })).toThrow(/要 name/);
    expect(() => assetLocationOf({ kind: "cg", name: "  " })).toThrow(/要 name/);
    expect(() => assetLocationOf({ kind: "sprite" })).toThrow(/要 spriteId/);
    expect(() => assetLocationOf({ kind: "portrait" })).toThrow(/kind/);
  });

  it("取景与体量原样带过去（枚举由宿主的 schema 兜）", () => {
    expect(assetLocationOf({ kind: "sprite", spriteId: "mecha", framing: "square", stature: "huge" })).toEqual({
      kind: "sprite",
      spriteId: "mecha",
      variant: "neutral",
      framing: "square",
      stature: "huge",
    });
  });
});

describe("asset.register", () => {
  it("把来源与归一化后的落位交给宿主的 IO，注记只传非空的", async () => {
    const { calls, fake } = deps();
    const out = await assetRegister.execute(
      {
        source: "media-cache/drafts/abc/image.png",
        kind: "sprite",
        spriteId: "lin",
        variant: "smile",
        description: " 撑着伞笑 ",
        prompt: "",
        original: "media-cache/drafts/abc/raw.png",
      },
      fake,
    );
    expect(calls).toEqual([
      {
        source: "media-cache/drafts/abc/image.png",
        location: { kind: "sprite", spriteId: "lin", variant: "smile" },
        extra: { description: "撑着伞笑", original: "media-cache/drafts/abc/raw.png" },
      },
    ]);
    expect(out).toEqual({ kind: "sprite", path: "assets/sprites/lin/smile.png", replaced: false });
  });

  it("来源是空的就直接拒绝（不去猜宿主路径）", async () => {
    const { fake } = deps();
    await expect(assetRegister.execute({ source: "  ", kind: "background", name: "rooftop" }, fake)).rejects.toThrow(/source/);
  });

  it("落位七格与出图共用同一份字段定义（不是抄一份）", () => {
    for (const key of ["kind", "name", "spriteId", "variant", "framing", "stature", "title"]) {
      expect(assetRegister.fields[key as keyof typeof assetRegister.fields]).toBe(
        assetTargetFields[key as keyof typeof assetTargetFields],
      );
    }
  });
});
