import { describe, expect, it } from "vitest";
import { parseAssetRef } from "../src/media/asset-ref.js";
import { imageCutout, type CutoutRequest } from "../src/capabilities/media/cutout.js";

describe("已入库立绘路径识别（parseAssetRef）", () => {
  it("assets/sprites/<id>/<variant>.<ext> 直接识别为立绘目标", () => {
    expect(parseAssetRef("assets/sprites/lin/smile.png")).toEqual({ kind: "sprite", spriteId: "lin", variant: "smile" });
    expect(parseAssetRef(" ./assets/sprites/mio/neutral.png ")).toEqual({
      kind: "sprite",
      spriteId: "mio",
      variant: "neutral",
    });
  });

  it("非标准立绘落位的路径一律返回 null（按普通源图路径处理）", () => {
    expect(parseAssetRef("media-cache/drafts/a/image.png")).toBeNull();
    expect(parseAssetRef("assets/cg/old.png")).toBeNull();
    expect(parseAssetRef("assets/sprites/loose.png")).toBeNull();
    expect(parseAssetRef("assets/sprites/a/b/c.png")).toBeNull();
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
          return {
            path: request.output ?? "media-cache/cut/x.png",
            absPath: "/tmp/x.png",
            coverage: 0.4,
            figureTop: 1020,
            figureHeight: 900,
          };
        },
      },
    };
  }

  it("给草稿/普通路径：原样交给宿主，带出 output 与调参", async () => {
    const { calls, deps } = stub();
    await imageCutout.execute(
      { source: " media-cache/drafts/a/image.png ", output: "assets/sprites/lin/neutral.png", tolerance: 60 },
      deps,
    );
    expect(calls).toEqual([
      { source: "media-cache/drafts/a/image.png", output: "assets/sprites/lin/neutral.png", tuning: { tolerance: 60 } },
    ]);
  });

  it("给已入库立绘路径：把立绘身份交给宿主（自动读留底原片原地重抠）", async () => {
    const { calls, deps } = stub();
    await imageCutout.execute({ source: "assets/sprites/lin/neutral.png" }, deps);
    expect(calls).toEqual([{ target: { kind: "sprite", spriteId: "lin", variant: "neutral" } }]);
  });
});
