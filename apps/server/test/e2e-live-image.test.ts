import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GeminiImageGen } from "../src/geminiImage.js";
import { IMAGE_ASPECTS, IMAGE_SIZES, aspectMatches } from "../src/imageBackend.js";

/**
 * 真实网关出图的独立端到端用例——平时 **不跑**（真 API 花钱），要跑时显式开关：
 *
 *   STAGE_E2E_LIVE=1 STAGE_IMAGE_API_KEY=<key> pnpm exec vitest run test/e2e-live-image.test.ts
 *
 * 全文件最多 **一次** 真实生图（单 it），断言落在「别名 + imageConfig 真的生效」上：
 * 请求 9:16，回来的图就是竖构图。这是别名铁律唯一的自动化证据——传完整模型名时
 * 网关会静默忽略 generationConfig，画幅被模型名钉死，而单测里的假 fetch
 * 看不见这件事（它会照样把参数拼进请求体）。
 *
 * 为什么断言 9:16 而不是 3:4：2026-09-29 对本机网关实测（imageSize=2k）
 *   16:9 → 1376x768 ✅   9:16 → 768x1376 ✅   3:4 → 1200x896 ❌   4:3 → 1200x896 ❌
 * 当时读成「上游不认 3:4」，2026-10-04 查清真相是**网关把 3:4 / 4:3 两档的枚举接反了**
 * （数字 4 才是 3:4、数字 5 才是 4:3，枚举名同理相反），已在网关侧修正：修正后
 * 3:4 → 896x1200 ✅、4:3 → 1200x896 ✅，带垫图与不带垫图两条链路都实测过。
 * 这里仍取 9:16：它同时是 full 取景的画幅，且不经过那条换算。
 * `PlayAssets.assertCanvas` 依旧是画幅被静默改掉时的兜底。
 */

const LIVE = process.env.STAGE_E2E_LIVE === "1";
const BASE_URL = process.env.STAGE_IMAGE_BASE_URL ?? "http://127.0.0.1:38000";
const MODEL = "gemini-3.1-flash-image";

/** 读图幅：PNG 走 IHDR，JPEG 走 SOFn 扫描。认不出就返回 null（不因此判失败）。 */
function imageSizeOf(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; ) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1]!;
      // SOF0..SOF15，跳过 DHT(c4)/JPGA(c8)/DAC(cc)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

describe.skipIf(!LIVE)("E2E 真实生图（STAGE_E2E_LIVE=1 才跑，全程只出 1 张）", () => {
  it(
    "flow2api 的别名模型 + imageConfig 9:16 真的生效",
    async () => {
      const gen = new GeminiImageGen({
        baseUrl: BASE_URL,
        apiKey: process.env.STAGE_IMAGE_API_KEY ?? "",
        model: MODEL,
        size: (IMAGE_SIZES as readonly string[]).includes(process.env.STAGE_IMAGE_SIZE ?? "")
          ? (process.env.STAGE_IMAGE_SIZE as "1k" | "2k" | "4k")
          : "2k",
        timeoutMs: 240_000,
      });
      const aspectRatio = "9:16";
      expect(IMAGE_ASPECTS).toContain(aspectRatio);

      const out = await gen.generate({
        prompt:
          "A 16-year-old girl with long black hair, school uniform, standing by a window at dusk, " +
          "anime visual novel character art, no text, no watermark.",
        aspectRatio,
      });

      // 落盘留证：画幅对不上时要能打开原图看，别再花钱重出一张
      const ext = out.mimeType.includes("png") ? "png" : "jpg";
      const dump = join(tmpdir(), `stage-live-image.${ext}`);
      writeFileSync(dump, out.data);
      console.log(`[live-image] ${out.mimeType} ${out.data.length}B → ${dump}`);

      expect(out.mimeType).toMatch(/^image\//);
      expect(out.data.length).toBeGreaterThan(20_000);

      const size = imageSizeOf(out.data);
      expect(size, `无法识别的图片格式：${out.mimeType}`).not.toBeNull();
      console.log(`[live-image] 尺寸 ${size!.width}x${size!.height}`);
      // 与 PlayAssets.assertCanvas 同一把尺：画幅不符必须是红的，不能悄悄落盘
      expect(aspectMatches(size!, aspectRatio)).toBe(true);
    },
    300_000,
  );
});
