import { describe, expect, it } from "vitest";
import { formatAssetRef, parseAssetRef } from "../src/media/asset-ref.js";
import { imageCutout, type CutoutRequest } from "../src/capabilities/media/cutout.js";

describe("素材引用", () => {
  it("立绘：带差分、不带差分（按 neutral）、主体 id 原样保留", () => {
    expect(parseAssetRef("sprite:lin/smile")).toEqual({ kind: "sprite", spriteId: "lin", variant: "smile" });
    expect(parseAssetRef(" sprite:mio ")).toEqual({ kind: "sprite", spriteId: "mio", variant: "neutral" });
    expect(parseAssetRef("sprite:mecha/damaged")).toEqual({ kind: "sprite", spriteId: "mecha", variant: "damaged" });
  });

  it("背景与插图：`<kind>:<名称>`", () => {
    expect(parseAssetRef("background:rooftop")).toEqual({ kind: "background", name: "rooftop" });
    expect(parseAssetRef("cg:rooftop_rain")).toEqual({ kind: "cg", name: "rooftop_rain" });
  });

  it("不含 `:` 的一律当路径（老调用一字不改），未知前缀也是路径", () => {
    expect(parseAssetRef("assets/cg/old.png")).toBeNull();
    expect(parseAssetRef("./a:b.png")).toBeNull();
    expect(parseAssetRef("http://example.com/a.png")).toBeNull();
    expect(parseAssetRef("draft:abc")).toBeNull();
  });

  it("认得出前缀但写法不合法：当场报错，不掉回路径分支（否则会报成「文件找不到」）", () => {
    expect(() => parseAssetRef("sprite:")).toThrow(/缺名称/);
    expect(() => parseAssetRef("sprite:lin/smile/extra")).toThrow(/多了层级/);
    expect(() => parseAssetRef("background:a/b")).toThrow(/不该带斜杠/);
    expect(() => parseAssetRef("sprite:/smile")).toThrow(/缺主体 id/);
  });

  it("落位 → 引用串：neutral 不写出来（默认就是它）", () => {
    expect(formatAssetRef({ kind: "sprite", spriteId: "lin", variant: "neutral" })).toBe("sprite:lin");
    expect(formatAssetRef({ kind: "sprite", spriteId: "lin", variant: "smile" })).toBe("sprite:lin/smile");
    expect(formatAssetRef({ kind: "sprite", spriteId: "lin" })).toBe("sprite:lin");
    expect(formatAssetRef({ kind: "background", name: "rooftop" })).toBe("background:rooftop");
    expect(formatAssetRef({ kind: "cg", name: "x" })).toBe("cg:x");
  });
});

describe("image.cutout 的两种寻址", () => {
  function stub() {
    const calls: CutoutRequest[] = [];
    return {
      calls,
      deps: {
        cut: async (request: CutoutRequest) => {
          calls.push(request);
          return { path: request.output ?? "media-cache/cut/x.png", absPath: "/tmp/x.png", coverage: 0.4, figureHeight: 900 };
        },
      },
    };
  }

  it("给路径：原样交给宿主，带出 output 与调参", async () => {
    const { calls, deps } = stub();
    await imageCutout.execute({ source: " media-cache/drafts/a/image.png ", output: "assets/sprites/lin/neutral.png", tolerance: 60 }, deps);
    expect(calls).toEqual([
      { source: "media-cache/drafts/a/image.png", output: "assets/sprites/lin/neutral.png", tuning: { tolerance: 60 } },
    ]);
  });

  it("给引用：只把身份交给宿主（语法不出这一层），差分不给按 neutral", async () => {
    const { calls, deps } = stub();
    await imageCutout.execute({ source: "sprite:lin" }, deps);
    expect(calls).toEqual([{ target: { kind: "sprite", spriteId: "lin", variant: "neutral" } }]);
  });

  it("引用写坏了在能力这一层就报错，不惊动宿主", async () => {
    const { calls, deps } = stub();
    await expect(imageCutout.execute({ source: "sprite:lin/x/y" }, deps)).rejects.toThrow(/多了层级/);
    expect(calls).toEqual([]);
  });
});
