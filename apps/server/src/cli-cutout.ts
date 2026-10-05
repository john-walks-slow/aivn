import fs from "fs";
import { cutout } from "./cutout.js";

const [,, inputPath = "", outputPath = ""] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: npx tsx apps/server/src/cli-cutout.ts <input> <output>");
  process.exit(1);
}

async function run() {
  const buf = fs.readFileSync(inputPath);
  const res = await cutout(buf);
  fs.writeFileSync(outputPath, res.data);
  console.log(`Cutout done: ${outputPath} (${res.width}x${res.height}, figureHeight=${res.figureHeight}, cov=${(res.coverage * 100).toFixed(1)}%)`);
}

run().catch((err) => {
  console.error("Cutout failed:", err);
  process.exit(2);
});
