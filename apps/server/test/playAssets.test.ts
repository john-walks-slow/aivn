import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Limiter } from "../src/limiter.js";
import { cutout, resolveTuning } from "../src/cutout.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayStore } from "../src/store.js";
import { PlayAssets } from "../src/playAssets.js";
import { parseCharacterCard, serializeCharacterCard, type CharacterDocument } from "@aivn/core";
import type { GeneratedImage, ImageAspect, ImageBackend, ImageRequest } from "../src/imageBackend.js";
import type { PlayFileWrite } from "../src/workshop.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** 带真实 IHDR 的最小 PNG：画幅回执校验只读这 16~23 字节就够，不必是能解码的完整图。 */
function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/**
 * 真图：浅色纯底 + 深色人形。立绘要过抠底（sharp 真解码），所以桩不能是假字节头。
 * 尺寸按**请求的画幅**推（16:9 → 1365x768，9:16 → 768x1365，3:4/2:3 同理）——
 * `assertCanvas` 会拿实际尺寸与请求画幅对拍，桩回一个别的尺寸等于自己造一张回执不符的图。
 */
async function realImage(aspect: ImageAspect, mimeType: string): Promise<Buffer> {
  const [ratioW, ratioH] = aspect.split(":").map(Number);
  const height = 1365;
  const width = Math.round((height * ratioW!) / ratioH!);
  const figure = await sharp({
    create: {
      width: Math.round(width * 0.5),
      height: Math.round(height * 0.7),
      channels: 3,
      background: "#3c4678",
    },
  })
    .png()
    .toBuffer();
  const composed = await sharp({
    // 纯绿色键底：抠底会体检底色，白底/灰底直接报错（见 cutout.ts 的 assertKeyBackground）。
    create: { width, height, channels: 3, background: "#00ff00" },
  })
    .composite([{ input: figure, left: Math.round(width * 0.25), top: Math.round(height * 0.15) }])
    .png()
    .toBuffer();
  return mimeType === "image/png" ? composed : await sharp(composed).jpeg().toBuffer();
}

async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-wassets-"));
  await mkdir(join(dir, "memory", "always"), { recursive: true });
  // play.json 不再承载角色配置（那份 characters 是纯元数据，没有任何逻辑读它）：
  // 角色表就是顶层 characters/ 下的文件。
  await writeFile(
    join(dir, "play.json"),
    JSON.stringify({
      id: "test",
      title: "测试剧目",
      premise: "测试 premise",
      opening: "（开始）",
      initialState: { turn: 0, affinity: {}, flags: {} },
      initialScene: "走廊",
    }),
  );
  await writeCard(dir, "mio", { id: "mio", name: "澪", body: "测试角色" });
  await writeCard(dir, "Koharu", { id: "Koharu", name: "小春", body: "合法的大写 id" });
  await writeFile(join(dir, "memory", "always", "premise.md"), "# 前提\n");
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
}

/** 落一张角色卡（角色配置的唯一落点）。 */
async function writeCard(dir: string, id: string, doc: CharacterDocument): Promise<void> {
  const path = join(dir, "characters");
  await mkdir(path, { recursive: true });
  await writeFile(join(path, `${id}.md`), serializeCharacterCard({ ...doc, id }), "utf8");
}

/** 落一份素材表（立绘的呈现声明与差分描述都在这里，角色卡上不再承载这些）。 */
async function writeManifest(dir: string, manifest: Record<string, unknown>): Promise<void> {
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "assets", "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

/** 读回一张角色卡：出图补写的差分映射与取景都断言它。 */
async function readCard(files: PlayFiles, id: string): Promise<CharacterDocument> {
  return parseCharacterCard(await files.read(`characters/${id}.md`));
}

/** 记录每次出图请求的假后端：按请求画幅回真图，用来验画幅、抠底与换扩展名清旧。 */
function stubBackend(mimeType = "image/jpeg"): { backend: ImageBackend; calls: ImageRequest[] } {
  const calls: ImageRequest[] = [];
  const backend: ImageBackend = {
    generate: async (req): Promise<GeneratedImage> => {
      calls.push(req);
      return { data: await realImage(req.aspectRatio, mimeType), mimeType };
    },
  };
  return { backend, calls };
}

function makeAssets(
  store: PlayStore,
  backend: ImageBackend,
  concurrency = 2,
  reference?: "none" | "neutral",
  fetchImage?: (url: string) => Promise<{ data: Buffer; mimeType: string }>,
): {
  assets: PlayAssets;
  files: PlayFiles;
  writes: PlayFileWrite[];
} {
  const files = new PlayFiles(store);
  const writes: PlayFileWrite[] = [];
  return {
    files,
    writes,
    assets: new PlayAssets("test", {
      store,
      files,
      backend,
      limiter: new Limiter(concurrency),
      ...(reference ? { reference } : {}),
      ...(fetchImage ? { fetchImage } : {}),
      onWrite: (w) => writes.push(w),
      // 自动注册临时角色走这条；用例不接时就是「当前环境不能自动建卡」
      writeCharacter: async (charId, content) => {
        const dir = join(store.dir, "characters");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${charId}.md`), content, "utf8");
      },
    }),
  };
}

describe("PlayAssets：原地重抠（抠底参数的后悔药）", () => {
  it("出图留底原片，重抠不再调后端、只改透明边缘（不透明像素逐位相同）", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    const [first] = await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    expect(calls).toHaveLength(1);
    const source = store.spriteSourceDir("mio", "neutral.jpg");
    expect(existsSync(source)).toBe(true); // 留底在 media-cache/：抠底前那一张原片，跑批产物不进 git

    const tuning = { tolerance: 20 };
    const recut = await assets.recut({ kind: "sprite", spriteId: "mio", variant: "neutral" }, tuning);
    expect(calls).toHaveLength(1); // 重新出图会多烧一份配额，这里一次都没有
    expect(recut.path).toBe("assets/sprites/mio/neutral.png");
    expect(recut.replaced).toBe(true);
    const written = await readFile(files.absoluteOf(recut.path));
    expect((await sharp(written).metadata()).hasAlpha).toBe(true);
    // 参数真的走到抠底层了：产物等于拿同一张留底按这档参数重抠的结果
    const expected = await cutout(await readFile(source), resolveTuning(tuning));
    expect(written.equals(expected.data)).toBe(true);
    // 而画面没动：两处都不透明的像素逐位相同，只改了边缘的透明度
    expect(await opaquePixelDiff(files.absoluteOf(first!.path), files.absoluteOf(recut.path))).toBe(0);

    // 留底必须是当初那一张原片：默认档重抠要逐字节复现出图时的产物，
    // 否则「重抠」修的是另一张画（读到了别的留底、或留底被二次编码过）。
    const again = await assets.recut({ kind: "sprite", spriteId: "mio", variant: "neutral" });
    expect(await readFile(files.absoluteOf(again.path))).toEqual(await readFile(files.absoluteOf(first!.path)));
  });

  it("换后端后重新出图：旧扩展名的留底要清掉，否则重抠一直在抠上一张画", async () => {
    const store = await makeStore();
    const { assets } = makeAssets(store, stubBackend("image/jpeg").backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    const dir = store.spriteSourceDir("mio");
    expect(existsSync(join(dir, "neutral.jpg"))).toBe(true);

    await makeAssets(store, stubBackend("image/png").backend).assets.generate(
      { kind: "sprite", spriteId: "mio", variant: "neutral" },
      "少女",
    );
    expect(existsSync(join(dir, "neutral.png"))).toBe(true);
    expect(existsSync(join(dir, "neutral.jpg"))).toBe(false);
  });

  it("没留底原片的老图 / 上传图直接报错，不偷偷重新出图", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    // 用户自己上传的立绘：assets/ 里有一张，media-cache 里没有留底
    await mkdir(join(files.absoluteOf("assets/sprites/Koharu")), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/Koharu/neutral.png"), await realImage("9:16", "image/png"));
    await expect(assets.recut({ kind: "sprite", spriteId: "Koharu", variant: "neutral" })).rejects.toThrow(
      /没有留底原片/,
    );
    await expect(assets.recut({ kind: "sprite", spriteId: "mio", variant: "smile" })).rejects.toThrow(
      /还没有抠底图/,
    );
    expect(calls).toHaveLength(1); // 两种情况都不该退回「重新出图」
  });

  it("重抠失败不落半残图：原来的透明 PNG 原封不动", async () => {
    const store = await makeStore();
    const { assets, files } = makeAssets(store, stubBackend().backend);
    const [res] = await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    const before = await readFile(files.absoluteOf(res!.path));
    // 把留底换成一张纯底图：抠底认不出前景，按覆盖率守卫直接报错
    const blank = await sharp({ create: { width: 768, height: 1365, channels: 3, background: "#ffffff" } })
      .png()
      .toBuffer();
    await writeFile(store.spriteSourceDir("mio", "neutral.jpg"), blank);
    await expect(assets.recut({ kind: "sprite", spriteId: "mio", variant: "neutral" })).rejects.toThrow(/抠底失败/);
    expect(await readFile(files.absoluteOf(res!.path))).toEqual(before);
  });
});

/** 两张 RGBA 里「两处都不透明」的像素有多少处 RGB 不同——重抠只该动边缘。 */
async function opaquePixelDiff(a: string, b: string): Promise<number> {
  const [ra, rb] = await Promise.all([sharp(a).ensureAlpha().raw().toBuffer(), sharp(b).ensureAlpha().raw().toBuffer()]);
  let diff = 0;
  for (let i = 0; i < ra.length; i += 4) {
    if (ra[i + 3] !== 255 || rb[i + 3] !== 255) continue;
    if (ra[i] !== rb[i] || ra[i + 1] !== rb[i + 1] || ra[i + 2] !== rb[i + 2]) diff += 1;
  }
  return diff;
}

describe("PlayAssets：逐剧目生图配置", () => {
  it("每次出图现读 play.json 的 image 段，改了立刻生效（map 缓存不失效也不会拿旧值）", async () => {
    // playAssets 按剧目缓存、进程内不重建：构造时取快照会让「设置页改了模型，出图还是老模型」。
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { files, assets } = makeAssets(store, backend);

    await assets.generate({ kind: "background", name: "a" }, "p");
    expect(calls[0]!.model).toBeUndefined();

    const raw = JSON.parse(await readFile(join(store.dir, "play.json"), "utf8")) as Record<string, unknown>;
    raw.image = { model: "gemini-3-pro-image", size: "4K" };
    await files.write("play.json", JSON.stringify(raw, null, 2));

    await assets.generate({ kind: "background", name: "b" }, "p");
    expect(calls[1]!.model).toBe("gemini-3-pro-image");
    expect(calls[1]!.size).toBe("4K");
  });
});

describe("PlayAssets：工坊素材落盘", () => {
  it("背景落 assets/backgrounds/ 16:9，同名再生成算覆盖并清掉旧扩展名", async () => {
    const store = await makeStore();
    const { backend } = stubBackend("image/jpeg");
    const { assets, files } = makeAssets(store, backend);

    const [first] = await assets.generate({ kind: "background", name: "rooftop" }, "黄昏天台");
    expect(first!.path).toBe("assets/backgrounds/rooftop.jpg");
    expect(first!.url).toBe("/plays/test/assets/backgrounds/rooftop.jpg");
    expect(first!.replaced).toBe(false);
    expect(existsSync(files.absoluteOf("assets/backgrounds/rooftop.jpg"))).toBe(true);

    // 同一 id 再出一次换成了 png：同一 stem 只留一张，素材索引里不留两个候选
    const [second] = await makeAssets(store, stubBackend("image/png").backend).assets.generate(
      { kind: "background", name: "rooftop" },
      "黄昏天台",
    );
    expect(second!.path).toBe("assets/backgrounds/rooftop.png");
    expect(second!.replaced).toBe(true);
    expect(existsSync(files.absoluteOf("assets/backgrounds/rooftop.jpg"))).toBe(false);
    expect(existsSync(files.absoluteOf("assets/backgrounds/rooftop.png"))).toBe(true);
  });

  it("立绘抠底成透明 PNG 落盘（引擎靠 alpha 叠在场景上）", async () => {
    const store = await makeStore();
    const { assets, files } = makeAssets(store, stubBackend().backend);
    const [res] = await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    expect(res!.path).toBe("assets/sprites/mio/neutral.png");
    const meta = await sharp(files.absoluteOf(res!.path)).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it("画幅：背景/CG 16:9，立绘 9:16", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "background", name: "a" }, "p");
    await assets.generate({ kind: "cg", name: "b" }, "p");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p");
    expect(calls.map((c) => c.aspectRatio)).toEqual(["16:9", "16:9", "9:16"]);
  });

  it("立绘取景：framing 决定画幅与提示词里的景别，三档各出一档", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    // 先定妆照：没有它时每条差分都会先自动补一张，把调用序号顶掉一位
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral", framing: "full" }, "p");
    calls.length = 0;
    // 半身用竖长画幅出：人脸占画幅近一半，仍按 9:16 出会被拉成窄条。
    // square 是非人主体那一档（猫、道具），也走 1:1，但提示词走的是另一套后缀。
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "a", framing: "half" }, "p");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "b", framing: "square" }, "p");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "c", framing: "full" }, "p");
    expect(calls.map((c) => c.aspectRatio)).toEqual(["3:4", "1:1", "9:16"]);
    expect(calls[0]!.prompt).toMatch(/medium shot, waist-up/);
    expect(calls[2]!.prompt).toMatch(/full body, head to toe/);
  });

  it("square（非人主体）不出人形词：没有 standing / 双臂 / 头顶留白", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    // 非人主体也是角色卡里的一条（成员校验照样拦），只是它声明 framing: square
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral", framing: "square" }, "a cat");
    const prompt = calls[0]!.prompt;
    // 人形专属词一个都不能有——给猫写「双臂离开身体以分离轮廓」，出来的是人形猫
    expect(prompt).not.toMatch(/standing/i);
    expect(prompt).not.toMatch(/arms/i);
    expect(prompt).not.toMatch(/above the head/i);
    expect(prompt).not.toMatch(/face/i);
    // 但通用构图与画风约束还在，抠底靠的就是这层
    expect(prompt).toMatch(/entire subject fully inside the frame/i);
    expect(prompt).toMatch(/single flat solid colour used as a chroma key/i);
  });

  it("full/half（人）：姿势由调用方写，引擎只补抠底要的留白", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate(
      { kind: "sprite", spriteId: "mio", variant: "neutral", framing: "full" },
      "a girl leaning on a windowsill, three-quarter view",
    );
    const prompt = calls[0]!.prompt;
    // 引擎后缀不曾覆盖调用方的姿势：早先这里固定拼 "front-facing standing pose, both arms held
    // slightly away from the body"，每个角色都成了同一个正面对称站桩，而这张图是所有差分的垫图基准。
    expect(prompt).not.toMatch(/front-facing/i);
    expect(prompt).not.toMatch(/standing pose/i);
    expect(prompt).toContain("leaning on a windowsill, three-quarter view");
    // 抠底要的那条留着：手臂与躯干之间夹着一条窄缝时，这段剪影会被切成两块
    expect(prompt).toMatch(/narrow sliver of background/i);
    expect(prompt).toMatch(/above the head/i);
  });

  it("立绘取景：素材表里声明过的取景会被沿用，不必每次都传", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await writeManifest(store.dir, { mio: { framing: "half" } });
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p");
    expect(calls[0]!.aspectRatio).toBe("3:4");
  });

  /**
   * 差分与定妆照**必须**都点名色键底。
   *
   * 这条是被真事故逼出来的：差分曾经只写「跟参考图同色」，而差分的参考图是**已抠底的
   * 透明 PNG**（没有颜色），模型把透明还原成白底，纯色键于是把角色身上一切接近白的像素
   * 判成背景——白袜、白衬衫、银发被整块抠穿，立绘打成镂空。
   * 见 `docs/issues/261008-sprite-variant-dirty-cutout/`。
   */
  it("出图后缀：定妆照与差分走同一个出口，两边都必须点名色键底", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "smile" }, "p");
    const neutralPrompt = calls[0]!.prompt;
    const variantPrompt = calls[1]!.prompt;
    for (const [label, prompt] of [
      ["定妆照", neutralPrompt],
      ["差分", variantPrompt],
    ] as const) {
      expect(prompt, `${label}缺色键底要求`).toMatch(/single flat solid colour used as a chroma key/i);
      expect(prompt, `${label}缺绿幕色值`).toMatch(/#00FF00/);
      // 绿系角色才换品红：这条也得在
      expect(prompt, `${label}缺换色规则`).toMatch(/#FF00FF/);
      // 「跟参考图同色」是错的那一句——参考图可能是透明 PNG，同色等于没规定
      expect(prompt, `${label}又写回了「跟参考图同色」`).not.toMatch(/same single flat solid background colour/i);
      expect(prompt, `${label}缺不许渐变的约束`).toMatch(/no gradient/i);
    }
  });

  it("出图后缀：片段拼接不产生双句点", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "smile" }, "p");
    // 手拼标点时期实测 57 条差分 prompt 里 30 条带着 `..`
    for (const call of calls) expect(call.prompt).not.toMatch(/\.\./);
  });

  /** 差分垫图必须是**带色键底的原片**，不是已抠底的透明 PNG（透明图正是白底事故的源头）。 */
  it("差分垫图：有留底原片就用原片，没有（用户导入的立绘）才退回抠好的 PNG", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p");
    const source = files.absoluteOf("media-cache/sprite-sources/mio/neutral.jpg");
    expect(existsSync(source), "出图应当留下原片").toBe(true);

    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "smile" }, "p");
    const ref = calls[calls.length - 1]!.references?.[0];
    expect(ref, "差分必须垫图").toBeTruthy();
    // 原片是绿底 JPEG；退回去的那张是抠好的 PNG（本身没有颜色）
    const isCutPng = (await sharp(ref!.data).metadata()).hasAlpha === true;
    expect(isCutPng, "差分垫的是已抠底的透明 PNG——它会诱导模型把透明还原成白底").toBe(false);

    // 没有原片的（用户导入）退回抠好的 PNG，且不许报错
    await rm(source, { force: true });
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "worried" }, "p");
    const fallback = calls[calls.length - 1]!.references?.[0];
    expect(fallback, "没有原片时仍要垫图").toBeTruthy();
    expect((await sharp(fallback!.data).metadata()).hasAlpha).toBe(true);
  });

  it("立绘取景：差分级的覆盖优先于立绘级，出图不改已有的声明", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await writeManifest(store.dir, { mio: { framing: "full" }, "mio/wow": { framing: "square" } });
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "wow" }, "p");
    // 第 0 次调用是自动补的定妆照：它按**立绘级**取景出，不按这条差分的 square
    expect(calls[0]!.aspectRatio).toBe("9:16");
    expect(calls[1]!.aspectRatio).toBe("1:1");
    const manifest = JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8"));
    // 差分覆盖只是覆盖，立绘级声明不能被一条差分带走
    expect(manifest.mio).toMatchObject({ framing: "full" });
    expect(manifest["mio/wow"]).toEqual({ framing: "square" });
  });

  it("立绘取景：中性定妆照同时立立绘级默认，声明随之落进素材表", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral", framing: "half" }, "p");
    const manifest = JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8"));
    expect(manifest.mio).toMatchObject({ framing: "half" });
    // 角色卡上一个字都不写：立绘的取景归素材表
    expect(await files.read("characters/mio.md")).not.toMatch(/framing/);
  });

  it("立绘取景：差分的提示词也带景别，否则垫图（全身）会把方形主体拖回人形", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral", framing: "square" }, "a cat");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "sleepy", framing: "square" }, "sleepy");
    expect(calls[1]!.references.length).toBe(1);
    expect(calls[1]!.prompt).toMatch(/same subject as the reference image/i);
    expect(calls[1]!.prompt).toMatch(/entire subject fully inside the frame/i);
    // 差分说「只改状态」而不是「只改面部表情」——猫没有「面部表情」可改
    expect(calls[1]!.prompt).not.toMatch(/facial expression/i);
  });

  it("CG 参考立绘：按给定顺序垫多张，提示词里点名「第几张是谁」", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    for (const id of ["mio", "Koharu"]) {
      await assets.generate({ kind: "sprite", spriteId: id, variant: "neutral" }, "p");
    }
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio", "Koharu"] }, "p");
    expect(calls[0]!.references).toHaveLength(2);
    // 序号锚点：模型只看到「第一张、第二张」，不点名就会画出两个长得一样的人
    expect(calls[0]!.prompt).toMatch(/in this exact order: 1\) 澪, 2\) 小春/);
    expect(calls[0]!.prompt).toMatch(/Do not merge them into one person/);
  });

  it("CG 参考立绘：数组顺序就是图序，反过来给就得反过来点名", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    for (const id of ["mio", "Koharu"]) {
      await assets.generate({ kind: "sprite", spriteId: id, variant: "neutral" }, "p");
    }
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["Koharu", "mio"] }, "p");
    expect(calls[0]!.prompt).toMatch(/in this exact order: 1\) 小春, 2\) 澪/);
  });

  it("CG 参考立绘：没有 neutral 也能垫，退回该主体目录里排序第一张差分", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    // 该主体只有 smile、根本没有 neutral：没有映射表可查，找图就是按目录里的文件名找
    await mkdir(files.absoluteOf("assets/sprites/mio"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mio/smile.png"), await realImage("9:16", "image/png"));
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio"] }, "p");
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.prompt).toMatch(/1\) 澪/);
  });

  it("CG 参考立绘：点名了但那个主体没立绘，直接报错不出一张少人的图", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await expect(
      assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["Koharu"] }, "p"),
    ).rejects.toThrow(/主体「Koharu」还没有立绘/);
    expect(calls).toHaveLength(0);
    expect(existsSync(files.absoluteOf("assets/cg/rooftop.jpg"))).toBe(false);
  });

  it("CG 参考立绘：主体既没有立绘也没有角色卡时报错并列出可选 id，不静默丢弃", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await expect(
      assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio", "ghost"] }, "p"),
    ).rejects.toThrow(/没有立绘也没有角色卡的主体「ghost」/);
  });

  it("CG 参考立绘：主体只有卡没有图时报错，不拿别人的脸顶上", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await writeCard(store.dir, "shion", { id: "shion", name: "诗音", body: "" });
    await expect(
      assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["shion"] }, "p"),
    ).rejects.toThrow(/主体「shion」还没有立绘/);
    expect(calls).toHaveLength(0);
  });

  it("CG 参考立绘：没有卡但有立绘也能垫，名牌回落到素材表的 title", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await mkdir(files.absoluteOf("assets/sprites/mecha"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mecha/neutral.png"), await realImage("9:16", "image/png"));
    await writeManifest(store.dir, { mecha: { title: "试作机" } });
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mecha"] }, "p");
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.prompt).toMatch(/1\) 试作机/);
  });

  it("CG 参考立绘：STAGE_IMAGE_REFERENCE=none 是全局开关，显式点名也一样不发", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend, 2, "none");
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p");
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio"] }, "p");
    expect(calls[0]!.references).toEqual([]);
    // 开关关掉垫图，但提示词里的序号锚点不能留着——没有图就没有「第几张」
    expect(calls[0]!.prompt).not.toMatch(/in this exact order/);
  });

  it("通用参考图：出 neutral 定妆照时带 references 垫图", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await mkdir(files.absoluteOf("assets/backgrounds"), { recursive: true });
    await writeFile(files.absoluteOf("assets/backgrounds/ref_char.png"), await realImage("9:16", "image/png"));

    await assets.generate(
      {
        kind: "sprite",
        spriteId: "mio",
        variant: "neutral",
        references: ["assets/backgrounds/ref_char.png"],
      },
      "a girl with ribbon",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.references![0]!.mimeType).toBe("image/png");
    // prompt 中拼装了定妆照垫图引导，且包含色键底与抠底留白约束
    expect(calls[0]!.prompt).toMatch(/Based on the attached reference image/);
    expect(calls[0]!.prompt).toMatch(/narrow sliver of background/i);
    expect(calls[0]!.prompt).toMatch(/single flat solid colour used as a chroma key/i);
    expect(existsSync(files.absoluteOf("assets/sprites/mio/neutral.png"))).toBe(true);
  });

  it("通用参考图：支持外部网络图片 URL 并正确加载", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const mockFetch = async (url: string) => {
      expect(url).toBe("https://example.com/character.jpg");
      return { data: await realImage("9:16", "image/jpeg"), mimeType: "image/jpeg" };
    };
    const { assets } = makeAssets(store, backend, 2, undefined, mockFetch);

    await assets.generate(
      {
        kind: "sprite",
        spriteId: "mio",
        variant: "neutral",
        references: ["https://example.com/character.jpg"],
      },
      "a girl",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.references![0]!.mimeType).toBe("image/jpeg");
    expect(calls[0]!.prompt).toMatch(/Based on the attached reference image/);
  });

  it("通用参考图：立绘差分不吃 references，恒以该角色 neutral 为基准（顶掉会静默换脸）", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await mkdir(files.absoluteOf("assets/sprites/mio"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mio/neutral.png"), await realImage("9:16", "image/png"));
    await mkdir(files.absoluteOf("assets/backgrounds"), { recursive: true });
    await writeFile(files.absoluteOf("assets/backgrounds/ref.png"), await realImage("16:9", "image/png"));
    calls.length = 0;

    await expect(
      assets.generate(
        {
          kind: "sprite",
          spriteId: "mio",
          variant: "smile",
          references: ["assets/backgrounds/ref.png"],
        },
        "p",
      ),
    ).rejects.toThrow(/不能自带参考图/);
    expect(calls).toHaveLength(0);
  });

  it("通用参考图：从界面复制来的静态 URL（带前导斜杠与 plays 前缀）也认", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await mkdir(files.absoluteOf("assets/backgrounds"), { recursive: true });
    await writeFile(files.absoluteOf("assets/backgrounds/scene_ref.jpg"), await realImage("16:9", "image/jpeg"));

    await assets.generate(
      { kind: "cg", name: "copied_ref", references: ["/plays/test/assets/backgrounds/scene_ref.jpg"] },
      "p",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.references).toHaveLength(1);
  });

  it("通用参考图：背景/CG 使用通用参考图并注入 genericReferenceSuffix", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await mkdir(files.absoluteOf("assets/backgrounds"), { recursive: true });
    await writeFile(files.absoluteOf("assets/backgrounds/scene_ref.jpg"), await realImage("16:9", "image/jpeg"));

    await assets.generate(
      {
        kind: "cg",
        name: "rooftop_sunset",
        references: ["assets/backgrounds/scene_ref.jpg"],
      },
      "rooftop sunset view",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.prompt).toMatch(/Follow the attached reference image\(s\) for visual appearance/);
  });

  it("画幅回执：模型回的画幅不对就报错，一个字节都不落盘", async () => {
    const store = await makeStore();
    // 实测 flow2api 对 3:4/4:3 静默出 1200x896 横图——立绘拿到横图等于站位崩
    const backend: ImageBackend = { generate: async () => ({ data: png(1200, 896), mimeType: "image/png" }) };
    const { assets, files } = makeAssets(store, backend);
    await expect(
      assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "p"),
    ).rejects.toThrow(/出图画幅不对：请求 9:16，模型回了 1200x896/);
    expect(existsSync(files.absoluteOf("assets/sprites/mio/neutral.png"))).toBe(false);
  });

  it("画幅回执：认不出的字节头不误伤，正常出图照常落盘", async () => {
    const store = await makeStore();
    // 读不出 IHDR/SOF 尺寸就跳过画幅校验，不把出图整体打死（背景路径不抠底，桩可以是假字节）
    const backend: ImageBackend = { generate: async () => ({ data: JPEG, mimeType: "image/jpeg" }) };
    const [res] = await makeAssets(store, backend).assets.generate({ kind: "background", name: "x" }, "p");
    expect(res!.path).toBe("assets/backgrounds/x.jpg");
  });

  it("素材名与差分名按文件名白名单校验，立绘 id 只挡路径分隔符（大小写不限）", async () => {
    const store = await makeStore();
    const { assets } = makeAssets(store, stubBackend().backend);

    await expect(assets.generate({ kind: "background", name: "../escape" }, "p")).rejects.toThrow(/非法/);
    await expect(assets.generate({ kind: "background" }, "p")).rejects.toThrow(/必须给 name/);
    await expect(assets.generate({ kind: "sprite", spriteId: "mio" }, "p")).rejects.toThrow(/差分名不能为空/);
    // 立绘 id 是目录名，不能靠它把文件写到别的目录去
    await expect(assets.generate({ kind: "sprite", spriteId: "../mio", variant: "smile" }, "p")).rejects.toThrow(
      /非法/,
    );
    // 立绘 id 不走文件名正则：角色卡文件名主体 Koharu 完全合法
    const out = await assets.generate({ kind: "sprite", spriteId: "Koharu", variant: "smile" }, "p");
    expect(out.at(-1)!.path).toBe("assets/sprites/Koharu/smile.png");
  });

  it("没有角色卡照样出图：机甲、道具与猫没有卡，出图不为一张图凭空造一张卡", async () => {
    const store = await makeStore();
    const { assets, files, writes } = makeAssets(store, stubBackend().backend);

    // 工坊（notify 缺省）与剧作家（notify=silent）走同一条路：立绘只按 spriteId 落目录
    for (const notify of [undefined, "silent"] as const) {
      const out = await assets.generate({ kind: "sprite", spriteId: "mecha", variant: "neutral" }, "p", undefined, {
        ...(notify ? { notify } : {}),
      });
      expect(out.at(-1)!.path).toBe("assets/sprites/mecha/neutral.png");
    }
    // 角色卡目录一个字节都不许动：卡是用户与工坊的账，一次出图不该塞进一个陌生人
    expect(existsSync(files.absoluteOf("characters/mecha.md"))).toBe(false);
    expect(writes.every((w) => !w.path.startsWith("characters/"))).toBe(true);
    // 声明照写：没有卡也有摆位与名牌的落点（第二次是同一份内容，不重复写盘）
    expect(writes.map((w) => w.path)).toEqual(["assets/manifest.json"]);
  });

  it("STAGE_IMAGE_REFERENCE=none：差分走纯文生图，不带参考图（定妆照照样自动补）", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend, 2, "none");

    const out = await assets.generate({ kind: "sprite", spriteId: "mio", variant: "smile" }, "少女");

    expect(out.at(-1)!.path).toBe("assets/sprites/mio/smile.png");
    // 定妆照是合法差分（actor 能直接引用），自动补一张；两次出图都不带垫图
    expect(calls).toHaveLength(2);
    expect(calls[0]!.references).toEqual([]);
    expect(calls[1]!.references).toEqual([]);
    expect(existsSync(files.absoluteOf("assets/sprites/mio/neutral.png"))).toBe(true);
  });

  it("差分自动先定妆照：垫图带上、提示词锁身份，呈现声明一并写进素材表", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files, writes } = makeAssets(store, backend);

    const out = await assets.generate({ kind: "sprite", spriteId: "mio", variant: "smile" }, "少女");
    // 返回 [自动定的 neutral, 用户点名的 smile]：两张都是真金白银出的，都得交出去
    expect(out.map((a) => a.path)).toEqual(["assets/sprites/mio/neutral.png", "assets/sprites/mio/smile.png"]);
    expect(out.at(-1)!.autoNeutral).toBe(true);
    // 先 neutral 后差分，两次出图
    expect(calls).toHaveLength(2);
    expect(calls[0]!.references).toEqual([]);
    // 自动补的定妆照前置了一条中性描述，压住差分那条 prompt 里的表情词
    expect(calls[0]!.prompt).toMatch(/neutral-expression/i);
    // 垫图是**抠底前的原片**（带色键底的那张 JPEG），不是盘上抠好的透明 PNG——
    // 垫透明图会让模型把透明还原成白底，纯色键随即把角色打穿。
    // 见 `docs/issues/261008-sprite-variant-dirty-cutout/`。
    expect(calls[1]!.references).toHaveLength(1);
    expect(calls[1]!.references![0]!.mimeType).toBe("image/jpeg");
    expect(calls[1]!.references![0]!.data.equals(await readFile(files.absoluteOf("media-cache/sprite-sources/mio/neutral.jpg")))).toBe(
      true,
    );
    // 而盘上那张抠好的 PNG 与垫图不是同一份（垫图带底色，PGN 透明）
    expect(calls[1]!.references![0]!.data.equals(await readFile(files.absoluteOf("assets/sprites/mio/neutral.png")))).toBe(
      false,
    );
    expect(calls[1]!.prompt).toContain("Same character as the reference image");

    // 呈现声明落素材表：立绘级一条（取景/体量），差分不需要覆盖就不写第二条
    expect(writes.map((w) => w.path)).toEqual(["assets/manifest.json"]);
    expect(JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8")).mio).toMatchObject({
      framing: "full",
      stature: "normal",
    });
    // 角色卡一个字节都不动：立绘不再是卡的附件
    expect(await files.read("characters/mio.md")).not.toMatch(/smile\.png/);
    expect(await files.read("play.json")).not.toContain("smile.png");
  });

  it("并发出两个差分：两条声明不能互相冲掉", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    // 先有一张定妆照，这一条测的是两条差分的声明并发写，不是自动补图
    await mkdir(files.absoluteOf("assets/sprites/mio"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mio/neutral.png"), await realImage("9:16", "image/png"));
    // 两条差分各自声明一套取景：后写的读旧表就会把先写的那条整段冲掉
    await writeManifest(store.dir, { mio: { framing: "full" } });

    // 把"后写的覆盖先写的"这个窗口撑开：两个 read 都到齐就立刻放行（无锁时必丢更新），
    // 到不齐就等 150ms 兜底（有锁时两次 read 天然串行，这里只是白等一会儿，不会挂死）
    const realRead = files.read.bind(files);
    let arrivals = 0;
    let release = (): void => {};
    const bothArrived = new Promise<void>((r) => (release = r));
    const timeout = setTimeout(release, 150);
    files.read = async (path: string) => {
      if (path === "assets/manifest.json" && ++arrivals <= 2) {
        await bothArrived;
        if (arrivals >= 2) release();
      }
      return realRead(path);
    };

    // 两个 read-modify-write 真并发
    const [smile, sad] = await Promise.all([
      assets.generate({ kind: "sprite", spriteId: "mio", variant: "smile", framing: "half" }, "少女"),
      assets.generate({ kind: "sprite", spriteId: "mio", variant: "sad", framing: "square" }, "少女"),
    ]);
    expect(smile.at(-1)!.path).toBe("assets/sprites/mio/smile.png");
    expect(sad.at(-1)!.path).toBe("assets/sprites/mio/sad.png");

    const manifest = JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8"));
    // 两条差分与它们各自的取景都得在
    expect(manifest["mio/smile"]).toEqual({ framing: "half" });
    expect(manifest["mio/sad"]).toEqual({ framing: "square" });
    clearTimeout(timeout);
  });

  it("已有 neutral 时直接派生，不重复定妆", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    const [res] = await assets.generate({ kind: "sprite", spriteId: "mio", variant: "sad" }, "少女");
    expect(res!.autoNeutral).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.references).toHaveLength(1);
  });

  it("缺 neutral 但已有其它差分：报错让人先过目新定妆照（否则演出里静默换脸）", async () => {
    const store = await makeStore();
    const files = new PlayFiles(store);
    await mkdir(files.absoluteOf("assets/sprites/mio"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mio/smile.jpg"), JPEG);

    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await expect(assets.generate({ kind: "sprite", spriteId: "mio", variant: "angry" }, "少女")).rejects.toThrow(
      /静默换脸/,
    );
    expect(calls).toHaveLength(0);
  });

  it("同一目标并发两次只出一张图（inflight 去重）", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    const [a, b] = await Promise.all([
      assets.generate({ kind: "background", name: "rooftop" }, "黄昏天台"),
      assets.generate({ kind: "background", name: "rooftop" }, "黄昏天台"),
    ]);
    expect(calls).toHaveLength(1);
    expect(a[0]!.url).toBe(b[0]!.url);
  });

  it("并发出 6 个差分：定妆照只出 1 张，6 个差分垫的都是这同一张", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    const names = ["smile", "shy", "angry", "sad", "surprised", "thinking"];

    const results = await Promise.all(
      names.map((variant) => assets.generate({ kind: "sprite", spriteId: "mio", variant }, "少女")),
    );

    // 6 个差分 + 1 张定妆照 = 7 次出图。inflight 救不了这条（generate() 要先 await resolve
    // 才查表），不按 kindPath 登记在飞 promise 的话 6 条会各补一张，变成 12 次。
    // 6 个差分 + 1 张定妆照 = 7 次出图。6 条差分各自要去补定妆照，但它们的补图都打同一个
    // inflight key（sprites/mio/neutral），inflight 会合并成一次。
    expect(calls).toHaveLength(7);
    expect(calls.filter((c) => c.prompt.includes("neutral-expression"))).toHaveLength(1);
    // 6 个差分都垫了这唯一一张定妆照；垫图不统一 = 静默换脸
    expect(calls.filter((c) => (c.references ?? []).length > 0)).toHaveLength(6);
    // 6 份回执里的自动定妆照是同一条，不是各补一张
    for (const res of results) {
      expect(res[0]!.path).toBe("assets/sprites/mio/neutral.png");
      expect(res[1]!.autoNeutral).toBe(true);
    }
    // 差分就是目录里的文件名，没有第二份映射表要同步
    const onDisk = (await readdir(files.absoluteOf("assets/sprites/mio"))).map((f) => f.replace(/\.\w+$/, ""));
    expect(onDisk.sort()).toEqual(["angry", "neutral", "sad", "shy", "smile", "surprised", "thinking"]);
    // 7 次出图各自要走一遍抠底（768x1365，实测单次 ~850ms），默认 5s 只够跑一半，
    // 流水线上任何一点扰动都会翻成假红。这条测的是去重语义，不是性能，给足预算。
  }, 30_000);
});

describe("PlayAssets：出图留痕", () => {
  it("prompt 记进 assets/generated.json：立绘用 <角色id>/<差分名> 键，背景用文件名主体", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    await assets.generate({ kind: "background", name: "rooftop" }, "黄昏天台");

    const ledger = JSON.parse(await readFile(files.absoluteOf("assets/generated.json"), "utf8"));
    // 键与剧作家查表的方式一致（prompt.ts 先试 <角色id>/<差分名>），否则记录查不到
    expect(ledger["mio/neutral"]).toMatchObject({
      kind: "sprite",
      path: "assets/sprites/mio/neutral.png",
      // 记的是模型实际收到的那条（含引擎拼的构图后缀），不是工坊填的那半句
      prompt: calls[0]!.prompt,
    });
    expect(ledger.rooftop).toMatchObject({ kind: "background", prompt: calls[1]!.prompt });
    // 一张表一个写者：出图只往素材表补立绘的呈现声明，描述一个字不写
    const manifest = JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8"));
    expect(manifest.mio).toEqual({ framing: "full", stature: "normal" });
    expect(Object.keys(manifest)).not.toContain("rooftop");
  });

  it("台账不与工坊的描述表互相覆盖：各写各的", async () => {
    const store = await makeStore();
    // 素材表里已经有一条工坊手写的描述（旧格式：一个键一个字符串）
    await writeManifest(store.dir, { mio: "工坊写的描述" });
    const { assets, files } = makeAssets(store, stubBackend().backend);
    await assets.generate({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");

    const manifest = JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8"));
    expect(manifest.mio).toMatchObject({ description: "工坊写的描述", framing: "full" });
    expect(JSON.parse(await readFile(files.absoluteOf("assets/generated.json"), "utf8"))["mio/neutral"].prompt).toBeTruthy();
  });

  it("并发出 6 个差分：台账一条都不许被后写的冲掉", async () => {
    const store = await makeStore();
    const { assets, files } = makeAssets(store, stubBackend().backend);
    await Promise.all(
      ["normal", "smile", "shy", "angry", "sad", "surprised"].map((variant) =>
        assets.generate({ kind: "sprite", spriteId: "mio", variant }, "少女"),
      ),
    );
    const ledger = JSON.parse(await readFile(files.absoluteOf("assets/generated.json"), "utf8"));
    // 自动补的定妆照 + 6 个差分 = 7 条；读改写不串行就会只剩最后一条
    expect(Object.keys(ledger).sort()).toEqual([
      "mio/angry",
      "mio/neutral",
      "mio/normal",
      "mio/sad",
      "mio/shy",
      "mio/smile",
      "mio/surprised",
    ]);
  }, 30_000);

  it("定妆照后缀不发明人物特征：只说哪里要留白，不写死发型", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate(
      { kind: "sprite", spriteId: "mio", variant: "neutral" },
      "a girl with pink long straight hair down to her waist",
    );
    // 后缀里的每个词都会被当成设定印进图里：这里曾写着「between the twin tails」，
    // 于是所有角色都长出双马尾——prompt 明写 long straight hair 也救不回来。
    const sent = calls[0]!.prompt;
    expect(sent).toContain("never with a narrow sliver of background trapped between an arm and the torso");
    expect(sent.toLowerCase()).not.toMatch(/twin|tail|braid|ponytail/);
  });
});


describe("PlayAssets：无卡主体（临时路人与道具）", () => {
  it("出图不建角色卡：没有卡也有名牌与摆位可落", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets, files } = makeAssets(store, backend);

    await assets.generate(
      { kind: "sprite", spriteId: "passerby", title: "路人甲", variant: "neutral" },
      "a passerby, front view, plain white background",
    );

    // 卡目录里没有它：一次出图不该悄悄塞进一个陌生人
    await expect(readFile(join(store.characterDir(), "passerby.md"), "utf8")).rejects.toThrow();
    // 名牌落在素材表上，否则台上那个人只能显示 id
    const manifest = JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8"));
    expect(manifest.passerby).toMatchObject({ title: "路人甲" });
  });

  it("有卡时也照常出图，卡上的人设一个字不动", async () => {
    const store = await makeStore();
    await writeCard(store.dir, "mio", { id: "mio", name: "美绪", body: "店员，寡言。" });
    const { backend } = stubBackend();
    const { assets, files } = makeAssets(store, backend);

    await assets.generate({ kind: "sprite", spriteId: "mio", title: "路人甲", variant: "neutral" }, "p");

    const card = await readFile(join(store.characterDir(), "mio.md"), "utf8");
    expect(card).toContain("name: 美绪");
    expect(card).toContain("店员，寡言。");
    // 名牌以卡上的 name 为准，立绘的 title 只是无卡时的回落——两边都写也不冲突
    expect(JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8")).mio.title).toBe("路人甲");
  });
});

describe("PlayAssets：出图与入库解耦（草稿 → 采用）", () => {
  it("draft 只落草稿区：不写 assets/（素材、素材表、台账一个都不碰）", async () => {
    const store = await makeStore();
    const { assets } = makeAssets(store, stubBackend().backend);
    const draft = await assets.draft({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");

    expect(draft.url).toBe(`/plays/test/drafts/${draft.draftId}/image.png`);
    expect(existsSync(join(store.draftDir(draft.draftId), "image.png"))).toBe(true);
    // 留底跟着入库走：出图阶段只有草稿目录里那一份 source
    expect(existsSync(join(store.draftDir(draft.draftId), "source.jpg"))).toBe(true);
    expect(existsSync(store.spriteSourceDir("mio", "neutral.jpg"))).toBe(false);
    expect(existsSync(join(store.dir, "assets", "sprites", "mio", "neutral.png"))).toBe(false);
    expect(existsSync(join(store.dir, "assets", "manifest.json"))).toBe(false);
    expect(existsSync(join(store.dir, "assets", "generated.json"))).toBe(false);
  });

  it("同一目标并发出的是几张**不同**的候选（草稿不去重）", async () => {
    const store = await makeStore();
    const { assets } = makeAssets(store, stubBackend().backend);
    const drafts = await Promise.all(
      [0, 1, 2].map(() => assets.draft({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女")),
    );
    expect(new Set(drafts.map((d) => d.draftId)).size).toBe(3);
  });

  it("commit 把草稿搬进 assets/：呈现声明与台账此时才写，留底原片跟着入库", async () => {
    const store = await makeStore();
    const { assets, files } = makeAssets(store, stubBackend().backend);
    const draft = await assets.draft(
      { kind: "sprite", spriteId: "mio", variant: "neutral", framing: "full", title: "澪" },
      "少女",
    );
    const asset = await assets.commit(draft.draftId);

    expect(asset.path).toBe("assets/sprites/mio/neutral.png");
    expect(existsSync(files.absoluteOf(asset.path))).toBe(true);
    expect(existsSync(store.spriteSourceDir("mio", "neutral.jpg"))).toBe(true);
    const manifest = JSON.parse(await files.read("assets/manifest.json")) as Record<string, Record<string, unknown>>;
    expect(manifest.mio).toMatchObject({ framing: "full", title: "澪" });
    const ledger = JSON.parse(await files.read("assets/generated.json")) as Record<string, { prompt?: string }>;
    expect(ledger["mio/neutral"]?.prompt).toContain("少女");
    // 入库后重抠能拿到留底（留底落在 sprite-sources 而不是草稿目录）
    const recut = await assets.recut({ kind: "sprite", spriteId: "mio", variant: "neutral" });
    expect(recut.replaced).toBe(true);
  });

  it("非 neutral 的草稿必须以**已入库**的 neutral 为基准", async () => {
    const store = await makeStore();
    const { assets } = makeAssets(store, stubBackend().backend);
    await expect(assets.draft({ kind: "sprite", spriteId: "mio", variant: "smile" }, "笑")).rejects.toThrow(
      /neutral/,
    );
    // 出一张定妆照草稿还不算基准，得先入库
    const neutral = await assets.draft({ kind: "sprite", spriteId: "mio", variant: "neutral" }, "少女");
    await expect(assets.draft({ kind: "sprite", spriteId: "mio", variant: "smile" }, "笑")).rejects.toThrow(
      /neutral/,
    );
    await assets.commit(neutral.draftId);
    await expect(assets.draft({ kind: "sprite", spriteId: "mio", variant: "smile" }, "笑")).resolves.toBeTruthy();
  });

  it("重复采用同一张草稿是幂等的：还是那一份素材，不产生第二份也不报错", async () => {
    const store = await makeStore();
    const { assets, files } = makeAssets(store, stubBackend().backend);
    const draft = await assets.draft({ kind: "background", name: "rooftop" }, "天台");
    const first = await assets.commit(draft.draftId);
    const again = await assets.commit(draft.draftId);

    // 契约里 adopted → adopted 是一条合法边（见 @aivn/core 的素材生命周期表）：重复采用
    // 不是错误。幂等说的是**产出**——同一个路径、台账里还是那一条，不会多出第二份。
    expect(again.path).toBe(first.path);
    const ledger = JSON.parse(await files.read("assets/generated.json")) as Record<string, unknown>;
    expect(Object.keys(ledger)).toEqual(["rooftop"]);
    // `replaced` 不是幂等位，它是如实回执：第一次是新建，第二次确实覆盖了上一次写的那份。
    expect(first.replaced).toBe(false);
    expect(again.replaced).toBe(true);
  });

  it("保留期常量来自共享契约：本地天数改了会与工坊对用户的承诺脱钩", async () => {
    // 这条钉的不是数字本身，而是「两边说的是同一件事」——DRAFT_TTL_MS 必须由
    // @aivn/core 的 ASSET_DRAFT_RETENTION_DAYS 推出来，不许再手写一遍。
    const source = await readFile(new URL("../src/playAssets.ts", import.meta.url), "utf8");
    expect(source).toContain("ASSET_DRAFT_RETENTION_DAYS");
    expect(source).not.toMatch(/DRAFT_TTL_MS\s*=\s*\d/);
  });
});
