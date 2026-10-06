import fs from "fs";
import sharp from "sharp";
import { cutout } from "/root/projects/stage-ai/apps/server/src/cutout.ts";

const DIR = "/root/projects/stage-ai/.worktrees/gal-repro/docs/gal-repro/cutout-test";
const SRC = `${DIR}/t1_green.jpg`;
const OUT = `${DIR}/sweep`;

const raw = fs.readFileSync(SRC);

type Row = {
  tol: number; smooth: number; band: number;
  solid: number; fringe: number; opaque: number; holes: number; coverage: number;
};

async function metrics(png: Buffer, bgColor: [number, number, number]): Promise<Omit<Row, "tol" | "smooth" | "band">> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let solid = 0, fringe = 0, opaque = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const a = data[o + 3]!;
    if (a === 0) continue;
    if (a === 255) opaque++;
    const r = data[o]!, g = data[o + 1]!, b = data[o + 2]!;
    const dBg = Math.max(Math.abs(r - bgColor[0]), Math.abs(g - bgColor[1]), Math.abs(b - bgColor[2]));
    const greenish = g > r + 25 && g > b + 25;
    if (dBg <= 40 && greenish) {
      if (a === 255) solid++;
      if (a >= 128) fringe++;
    }
  }
  // holes: fully transparent pixels that are inside the figure bounding box region
  const box = { x0: width, y0: height, x1: 0, y1: 0 };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3]! > 0) {
        if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
        if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
      }
    }
  let holes = 0;
  // scan rows: count transparent runs between first and last opaque pixel
  for (let y = box.y0; y <= box.y1; y++) {
    let first = -1, last = -1;
    for (let x = box.x0; x <= box.x1; x++) {
      if (data[(y * width + x) * channels + 3]! >= 200) { if (first < 0) first = x; last = x; }
    }
    if (first >= 0) {
      for (let x = first; x <= last; x++) {
        const a = data[(y * width + x) * channels + 3]!;
        if (a < 128) holes++;
      }
    }
  }
  return { solid, fringe, opaque, holes, coverage: 0 };
}

async function main() {
  const bg: [number, number, number] = [0, 255, 0];
  const rows: Row[] = [];
  const tols = [48, 64, 80, 96, 112, 128];
  const bands = [4, 6, 8];
  for (const tol of tols) {
    for (const band of bands) {
      const res = await cutout(raw, { tolerance: tol, keySmooth: 0.8, edgeBand: band });
      const m = await metrics(res.data, bg);
      rows.push({ tol, smooth: 0.8, band, ...m, coverage: res.coverage });
      fs.writeFileSync(`${OUT}/tol${tol}_band${band}.png`, res.data);
      console.log(`tol=${tol} band=${band}: solid=${m.solid} fringe=${m.fringe} opaque=${m.opaque} holes=${m.holes}`);
    }
  }
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
}
main();
