#!/usr/bin/env node
// 把生成出来的立绘底图（纯白底 9:16）过一遍项目自带的抠底管线，落成资源库里的
// 透明 PNG 角色包。抠底直接吃**原始下载字节**——过一遍 sharp 重编码等于二次抖边
// （同一张图误抠率能从 0.003% 涨到 0.455%），所以这里不预先缩放。
//
// 用法：node scripts/seed-library-sprites.mjs <生图目录> <资源库根> [角色id]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cutout } from "../apps/server/dist/cutout.js";

const EXPRESSIONS = {
  neutral: "无表情的默认站姿，用作其它差分的定妆锚",
  smile: "腼腆地微笑，双颊微红",
  worried: "担忧：眉心抬起、眼睛睁大、嘴唇微张",
  surprised: "吃惊：眼睛睁圆、眉毛上扬、嘴巴张成小圆形",
};

const [, , genDir, libraryRoot, charId = "nanase"] = process.argv;
if (!genDir || !libraryRoot) {
  console.error("用法: node scripts/seed-library-sprites.mjs <生图目录> <资源库根> [角色id]");
  process.exit(2);
}

const outDir = join(libraryRoot, "sprites", charId);
await mkdir(outDir, { recursive: true });

const expressions = {};
for (const [name, description] of Object.entries(EXPRESSIONS)) {
  const bytes = await readFile(join(genDir, `${name}.jpg`));
  const result = await cutout(bytes);
  await writeFile(join(outDir, `${name}.png`), result.data);
  expressions[name] = { file: `${name}.png`, description };
  console.log(`${name}.png  ${result.width}x${result.height}  前景占比 ${(result.coverage * 100).toFixed(1)}%  人物高 ${result.figureHeight}`);
}

const meta = {
  title: "七濑（示例角色）",
  description: "示例用的少女角色：深棕侧扎长发、灰瞳、藏青开衫配白衬衫校服。一整套差分可直接导入剧目当锚。",
  tags: ["少女", "校服", "示例角色", "多表情"],
  source: "本项目生成（flow2api / gemini-3.1-flash-image）+ 项目自带抠底管线（apps/server/src/cutout.ts）",
  character: {
    name: "七濑",
    persona: "安静、观察细致、不太会主动开口的少女；对熟人偶尔露出腼腆的笑。",
    voice: "语气轻、语速偏慢，句子短，情绪变化不大但在意时会更小声",
  },
  expressions,
};
await writeFile(join(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`\n角色包落在 ${outDir}`);
