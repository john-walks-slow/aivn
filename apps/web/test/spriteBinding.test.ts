import { describe, expect, it } from "vitest";
import { buildAssetIndex } from "../src/stage/assets.js";

/**
 * 立绘绑定：一个主体的立绘在 `assets/sprites/<目录>/` 里，目录名由角色卡的 `sprite:` 决定，
 * 不写就是与角色同名。舞台拿到的永远是 `<actor id>`，所以这一层必须把 id 解成目录再去查图——
 * 解错的表现是「卡在、图也在，台上就是不显示」。
 */
const ASSETS: Record<string, string[]> = {
  "sprites/rinne": ["neutral.png", "smile.png"],
  "sprites/mecha": ["neutral.png"],
};
const CAST = [{ id: "铃音", name: "铃音", sprite: "rinne", body: "" }];

describe("素材索引：立绘绑定", () => {
  it("卡上写了 sprite 就用那个目录，演员 id 与目录名可以不同名", () => {
    const index = buildAssetIndex("p1", ASSETS, {}, {}, CAST);
    expect(index.spriteDirOf("铃音")).toBe("rinne");
    // 舞台那一路：先解 id，再按目录查图与呈现
    const dir = index.spriteDirOf("铃音");
    expect(index.sprite(dir, "smile")).toBe("/plays/p1/assets/sprites/rinne/smile.png");
    expect(index.sprite(dir, null)).toBe("/plays/p1/assets/sprites/rinne/neutral.png");
    // 参考垫图选择器按目录反查名字，认的是绑定它的那张卡
    expect(index.spriteName("rinne")).toBe("铃音");
  });

  it("没写绑定就是同名；没有卡的主体照样有立绘与目录名", () => {
    const index = buildAssetIndex("p1", ASSETS, {}, {}, [{ id: "mio", name: "ミオ", body: "" }]);
    expect(index.spriteDirOf("mio")).toBe("mio");
    expect(index.spriteDirOf("mecha")).toBe("mecha");
    // 目录没人认领时不编名字：交给名牌回落链（卡 name → <say name> → 名牌 → id）
    expect(index.spriteName("mecha")).toBeNull();
    expect(index.spriteIds).toEqual(["mecha", "rinne"]);
  });

  it("缺差分退回目录第一张；立绘呈现按目录名读素材表", () => {
    const index = buildAssetIndex("p1", ASSETS, {}, { rinne: { framing: "half" } }, CAST);
    expect(index.sprite("rinne", "nope")).toBe("/plays/p1/assets/sprites/rinne/neutral.png");
    expect(index.spritePresentation("rinne", null)).toEqual({
      framing: "half",
      stature: "normal",
      anchor: "bottom",
    });
  });
});
