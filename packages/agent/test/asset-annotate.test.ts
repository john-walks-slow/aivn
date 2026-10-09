import { describe, expect, it } from "vitest";
import {
  assetAnnotate,
  assetSubjectOf,
  type AssetAnnotateDeps,
  type AssetMetaPatch,
  type AssetSubject,
} from "../src/index.js";

function deps(result: { path?: string; error?: string } = {}) {
  const calls: Array<{ subject: AssetSubject; patch: AssetMetaPatch }> = [];
  const fake: AssetAnnotateDeps = {
    annotate: async (subject, patch) => {
      calls.push({ subject, patch });
      if (result.error) throw new Error(result.error);
      return { path: result.path ?? "assets/bgm/bgm_rain.m4a" };
    },
  };
  return { fake, calls };
}

describe("asset.annotate", () => {
  it("只把真正给了的那几格交下去（空串与空数组不留）", async () => {
    const { fake, calls } = deps();
    await assetAnnotate.execute(
      {
        kind: "bgm",
        name: "  bgm_rain  ",
        title: "  雨   ",
        mood: ["温柔", "  ", ""],
        tags: [],
        loop: true,
      },
      fake,
    );
    expect(calls).toEqual([
      {
        subject: { kind: "bgm", name: "bgm_rain" },
        patch: { title: "雨", mood: ["温柔"], loop: true },
      },
    ]);
  });

  it("回执说清标了哪几格与落在哪个文件上", async () => {
    const { fake } = deps({ path: "assets/bgm/bgm_rain.m4a" });
    const text = await assetAnnotate.execute({ kind: "bgm", name: "bgm_rain", mood: ["温柔"] }, fake);
    expect(text).toContain("assets/bgm/bgm_rain.m4a");
    expect(text).toContain("mood");
  });

  it("一格都没给时不写盘，直接说清要给什么", async () => {
    const { fake, calls } = deps();
    const text = await assetAnnotate.execute({ kind: "bgm", name: "bgm_rain" }, fake);
    expect(calls).toHaveLength(0);
    expect(text).toContain("没给要标的内容");
  });

  it("写盘失败当一句正文回去，不炸整轮", async () => {
    const { fake } = deps({ error: "科目里没有这条素材" });
    const text = await assetAnnotate.execute({ kind: "cg", name: "cg_01", description: "告白" }, fake);
    expect(text).toContain("没能标注");
    expect(text).toContain("科目里没有这条素材");
  });

  it("立绘要 spriteId、其余要 name——缺项在这里一次说完", () => {
    expect(() => assetSubjectOf({ kind: "sprite" })).toThrow(/spriteId/);
    expect(() => assetSubjectOf({ kind: "bgm" })).toThrow(/name/);
    expect(() => assetSubjectOf({ kind: "music" })).toThrow(/kind/);
    // 差分不给 = 只标 neutral 那一层
    expect(assetSubjectOf({ kind: "sprite", spriteId: "mio" })).toEqual({ kind: "sprite", spriteId: "mio" });
  });
});
