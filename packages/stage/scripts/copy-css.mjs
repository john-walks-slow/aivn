// 舞台样式不是 tsc 的产物：构建后把它从 src 拷进 dist，包外只认 dist。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src/stage.css");
const to = join(root, "dist/stage.css");

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`stage.css → ${to}`);
