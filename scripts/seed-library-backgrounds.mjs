#!/usr/bin/env node
// 把生成出来的背景图落成资源库条目。背景是单文件条目，目录名即素材 id。
//
// 生图回来的是 1376x768 的高质量 JPEG（~800KB/张），直接进 git 纯属浪费——
// 背景是舞台上铺满的一层，q3 重编码视觉无差别，体积掉到四分之一。
//
// 用法：node scripts/seed-library-backgrounds.mjs <生图目录> <资源库根>
import { writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const ffmpeg = promisify(execFile);

// 描述是给剧作家看的：它得能从 id 之外判断「这场戏该不该用这张图」。
const BACKGROUNDS = {
  bg_classroom_sunset: {
    title: "放学后的空教室",
    description: "夕阳斜照的空教室，课桌投下长长的影子，空气里有浮尘。没有人。",
    tags: ["教室", "黄昏", "室内", "空景"],
    mood: ["温暖", "怀念", "寂寥"],
    scene: ["日常", "回忆", "离别前"],
  },
  bg_school_hallway: {
    title: "放学后的学校走廊",
    description: "一排教室门与落地窗，午后阳光在地板上投出一格一格的光斑，鞋柜边散着鞋。没有人。",
    tags: ["走廊", "室内", "午后", "空景"],
    mood: ["安静", "怀念"],
    scene: ["日常", "放学", "回忆"],
  },
  bg_rooftop_dusk: {
    title: "天台黄昏",
    description: "校园天台，铁丝网栏杆外是渐变的城市天际线，琥珀色转深紫，第一颗星出来了。没有人。",
    tags: ["天台", "黄昏", "室外", "城市", "空景"],
    mood: ["不舍", "温暖", "孤独"],
    scene: ["告白", "离别", "回忆"],
  },
  bg_rainy_window: {
    title: "雨夜窗边",
    description: "夜里从昏暗的房间里看出去，雨水顺着窗玻璃流下，窗外街灯化成光斑。没有人。",
    tags: ["室内", "夜晚", "雨", "窗", "空景"],
    mood: ["忧郁", "孤独", "安静"],
    scene: ["独处", "回忆", "低落"],
  },
  bg_cherry_blossom_street: {
    title: "樱花街道",
    description: "盛开的樱花树下安静的住宅街，粉色花瓣在晨光里飘，小水渠旁有矮栏杆。没有人。",
    tags: ["街道", "室外", "春天", "樱花", "空景"],
    mood: ["温柔", "清新", "心动"],
    scene: ["初遇", "约会", "日常"],
  },
};

const [, , genDir, libraryRoot] = process.argv;
if (!genDir || !libraryRoot) {
  console.error("用法: node scripts/seed-library-backgrounds.mjs <生图目录> <资源库根>");
  process.exit(2);
}

for (const [id, meta] of Object.entries(BACKGROUNDS)) {
  const outDir = join(libraryRoot, "backgrounds", id);
  await mkdir(outDir, { recursive: true });
  await ffmpeg("ffmpeg", ["-y", "-i", join(genDir, `${id}.jpg`), "-q:v", "3", join(outDir, `${id}.jpg`)]);
  await writeFile(
    join(outDir, "meta.json"),
    `${JSON.stringify(
      { ...meta, source: "本项目生成（flow2api / gemini-3.1-flash-image，16:9）" },
      null,
      2,
    )}\n`,
  );
  console.log(`${id}  ${((await stat(join(outDir, `${id}.jpg`))).size / 1024).toFixed(0)} KB`);
}
