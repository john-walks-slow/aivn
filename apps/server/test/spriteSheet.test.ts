import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { gridFor, sheetPrompt, sliceSheet, SHEET_MAX } from "../src/spriteSheet.js";

/** 从提示词里把「A CxR ... sheet」抠出来。提示词和切格共用 gridFor，这条就是防它们再分叉。 */
function gridInPrompt(count: number): { cols: number; rows: number } {
  const prompt = sheetPrompt({ character: "a girl", expressions: Array.from({ length: count }, (_, i) => `e${i}`) });
  const matched = /A (\d+)x(\d+) character expression sheet/.exec(prompt);
  if (!matched) throw new Error(`提示词里没找到网格描述：${prompt}`);
  return { cols: Number(matched[1]), rows: Number(matched[2]) };
}

describe("表情面板网格", () => {
  it.each(Array.from({ length: SHEET_MAX }, (_, i) => i + 1))(
    "%i 个差分：提示词说的网格必须就是切格用的网格",
    (count) => {
      expect(gridInPrompt(count)).toEqual(gridFor(count));
    },
  );

  it("列数钉死在 2、格数超 2 才往上加行", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => gridFor(n))).toEqual([
      { cols: 1, rows: 1 },
      { cols: 2, rows: 1 },
      { cols: 2, rows: 2 },
      { cols: 2, rows: 2 },
      { cols: 2, rows: 3 },
      { cols: 2, rows: 3 },
    ]);
  });

  it("提示词把差分名按「从左到右、从上到下」排清楚", () => {
    const prompt = sheetPrompt({ character: "a girl", expressions: ["smile", "pout", "shock"], style: "厚涂写实" });
    expect(prompt).toContain("Row 1 left to right, then row 2 left to right, the 3 panels are: smile, pout, shock");
    expect(prompt).toContain("厚涂写实");
  });
});

describe("切格", () => {
  it("按 2x3 切出 6 格，顺序是从左到右、从上到下", async () => {
    // 6 个色块：每格纯色，一眼能看出切到的是哪一格
    const tiles = [
      { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 },
      { r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 0 },
      { r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 255 },
    ];
    const tileBuffers = await Promise.all(
      tiles.map((color) => sharp({ create: { width: 100, height: 100, channels: 3, background: color } }).png().toBuffer()),
    );
    const composites = tileBuffers.map((input, i) => ({
      input,
      left: (i % 2) * 100,
      top: Math.floor(i / 2) * 100,
    }));
    const sheet = await sharp({
      create: { width: 200, height: 300, channels: 3, background: "#ffffff" },
    })
      .composite(composites)
      .png()
      .toBuffer();

    const cells = await sliceSheet(sheet, 6);
    expect(cells).toHaveLength(6);
    for (const [i, cell] of cells.entries()) {
      const { data } = await sharp(cell.data).raw().toBuffer({ resolveWithObject: true });
      expect([data[0], data[1], data[2]]).toEqual([tiles[i]!.r, tiles[i]!.g, tiles[i]!.b]);
    }
  });

  it("图太小切不出格子就报错，不切出半个表情", async () => {
    const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    await expect(sliceSheet(tiny, 4)).rejects.toThrow(/面板图太小/);
  });
});
