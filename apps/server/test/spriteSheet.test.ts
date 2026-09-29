import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { planSheet, sheetPrompt, sliceSheet, SHEET_MAX } from "../src/spriteSheet.js";

function gridInPrompt(plan: ReturnType<typeof planSheet>): { cols: number; rows: number } {
  const prompt = sheetPrompt({ character: "a girl", plan });
  const matched = /A (\d+)x(\d+) character expression sheet/.exec(prompt);
  if (!matched) throw new Error(`提示词里没找到网格描述：${prompt}`);
  return { cols: Number(matched[1]), rows: Number(matched[2]) };
}

describe("表情面板制式", () => {
  it.each([1, 2, 3, 4])("%i 个差分：提示词说的网格必须就是切格用的网格", (count) => {
    const names = Array.from({ length: count }, (_, i) => `e${i}`);
    const plan = planSheet(names);
    expect(gridInPrompt(plan)).toEqual({ cols: plan.cols, rows: plan.rows });
  });

  it("制式只有 2x1 和 2x2，列数钉死 2", () => {
    const shapes = [1, 2, 3, 4].map((n) => {
      const { cols, rows } = planSheet(Array.from({ length: n }, (_, i) => `e${i}`));
      return `${cols}x${rows}`;
    });
    expect(shapes).toEqual(["2x1", "2x1", "2x2", "2x2"]);
  });

  it("格子制式最大 4，超了报错让模型分两次", () => {
    expect(SHEET_MAX).toBe(4);
    expect(() => planSheet(["a", "b", "c", "d", "e"])).toThrow(/一次最多 4 个差分/);
  });

  it("差分不够一格时补 neutral——顺带出定妆照，空着的那格模型会画歪", () => {
    expect(planSheet(["smile"]).expressions).toEqual(["smile", "neutral"]);
    expect(planSheet(["smile", "pout"]).expressions).toEqual(["smile", "pout"]);
    expect(planSheet(["smile", "pout", "shock"]).expressions).toEqual(["smile", "pout", "shock", "neutral"]);
  });

  it("已经有 neutral 就不重复补，换下一个补位名", () => {
    expect(planSheet(["neutral", "smile"]).expressions).toEqual(["neutral", "smile"]);
    expect(planSheet(["neutral", "smile", "pout"]).expressions).toEqual(["neutral", "smile", "pout", "calm"]);
  });

  it("重名和空白差分先去重再定制式", () => {
    expect(planSheet(["smile", " smile ", "  "]).expressions).toEqual(["smile", "neutral"]);
  });

  it("提示词把差分名按从左到右从上到下排清楚，并要求人物站满格子", () => {
    const plan = planSheet(["smile", "pout", "shock"]);
    const prompt = sheetPrompt({ character: "a girl", plan, style: "厚涂写实" });
    expect(prompt).toContain("A 2x2 character expression sheet");
    expect(prompt).toContain("4 cells");
    expect(prompt).toContain("Row 1, then Row 2 left to right");
    expect(prompt).toContain("smile, pout, shock, neutral");
    expect(prompt).toContain("feet on the bottom edge of its cell");
    expect(prompt).toContain("Do not draw any grid lines");
    expect(prompt).toContain("厚涂写实");
  });
});

describe("切格", () => {
  it("按 2x2 切出 4 格，顺序是从左到右、从上到下", async () => {
    const tiles = [
      { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 0 },
    ];
    const buffers = await Promise.all(
      tiles.map((c) => sharp({ create: { width: 100, height: 100, channels: 3, background: c } }).png().toBuffer()),
    );
    const sheet = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } })
      .composite(buffers.map((input, i) => ({ input, left: (i % 2) * 100, top: Math.floor(i / 2) * 100 })))
      .png()
      .toBuffer();

    const cells = await sliceSheet(sheet, planSheet(["a", "b", "c", "d"]));
    expect(cells).toHaveLength(4);
    for (const [i, cell] of cells.entries()) {
      const { data } = await sharp(cell.data).raw().toBuffer({ resolveWithObject: true });
      expect([data[0], data[1], data[2]]).toEqual([tiles[i]!.r, tiles[i]!.g, tiles[i]!.b]);
    }
  });

  it("2x1 切 2 格，格子是整张图的一半高", async () => {
    const sheet = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#888888" } })
      .png()
      .toBuffer();
    const cells = await sliceSheet(sheet, planSheet(["a", "b"]));
    expect(cells.map((c) => [c.width, c.height])).toEqual([
      [100, 100],
      [100, 100],
    ]);
  });

  it("图太小切不出格子就报错，不切出半个表情", async () => {
    const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    await expect(sliceSheet(tiny, planSheet(["a", "b", "c", "d"]))).rejects.toThrow(/面板图太小/);
  });
});
