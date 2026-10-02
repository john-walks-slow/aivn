import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Limiter } from "../src/limiter.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayStore } from "../src/store.js";
import { PlayAssets } from "../src/playAssets.js";
import type { GeneratedImage, ImageAspect, ImageBackend, ImageRequest } from "../src/imageBackend.js";
import type { WorkshopWrite } from "../src/workshop.js";

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
    create: { width, height, channels: 3, background: "#f0f2f5" },
  })
    .composite([{ input: figure, left: Math.round(width * 0.25), top: Math.round(height * 0.15) }])
    .png()
    .toBuffer();
  return mimeType === "image/png" ? composed : await sharp(composed).jpeg().toBuffer();
}

async function makeStore(): Promise<PlayStore> {
  const dir = await mkdtemp(join(tmpdir(), "stage-wassets-"));
  await mkdir(join(dir, "memory", "always"), { recursive: true });
  await writeFile(
    join(dir, "play.json"),
    JSON.stringify({
      id: "test",
      title: "测试剧目",
      premise: "测试 premise",
      characters: [
        { id: "mio", name: "澪", persona: "测试角色" },
        { id: "Koharu", name: "小春", persona: "合法的大写 id" },
      ],
      opening: "（开始）",
      initialState: { turn: 0, affinity: {}, flags: {} },
      initialScene: "走廊",
    }),
  );
  await writeFile(join(dir, "memory", "always", "premise.md"), "# 前提\n");
  await writeFile(join(dir, "lineage.jsonl"), "");
  return new PlayStore(dir);
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

function makeAssets(store: PlayStore, backend: ImageBackend, concurrency = 2, reference?: "none" | "neutral"): {
  assets: PlayAssets;
  files: PlayFiles;
  writes: WorkshopWrite[];
} {
  const files = new PlayFiles(store);
  const writes: WorkshopWrite[] = [];
  return {
    files,
    writes,
    assets: new PlayAssets("test", {
      store,
      files,
      backend,
      limiter: new Limiter(concurrency),
      ...(reference ? { reference } : {}),
      onWrite: (w) => writes.push(w),
    }),
  };
}

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
    const [res] = await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "少女");
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
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "p");
    expect(calls.map((c) => c.aspectRatio)).toEqual(["16:9", "16:9", "9:16"]);
  });

  // 这条要在本机真编出 3 张不同画幅的图，慢机器上会顶穿默认的 5s
  it("立绘取景：framing 决定画幅与提示词里的景别，三档各出一档", { timeout: 20000 }, async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    // 先定妆照：没有它时每条差分都会先自动补一张，把调用序号顶掉一位
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral", framing: "full" }, "p");
    calls.length = 0;
    // 半身用竖长画幅出：人脸占画幅近一半，仍按 9:16 出会被拉成窄条。
    // square 是非人主体那一档（猫、道具），也走 1:1，但提示词走的是另一套后缀。
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "a", framing: "half" }, "p");
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "b", framing: "square" }, "p");
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "c", framing: "full" }, "p");
    expect(calls.map((c) => c.aspectRatio)).toEqual(["3:4", "1:1", "9:16"]);
    expect(calls[0]!.prompt).toMatch(/medium shot, waist-up/);
    expect(calls[2]!.prompt).toMatch(/full body, head to toe/);
  });

  it("square（非人主体）不出人形词：没有 standing / 双臂 / 头顶留白", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    // 非人主体也是角色卡里的一条（成员校验照样拦），只是它声明 framing: square
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral", framing: "square" }, "a cat");
    const prompt = calls[0]!.prompt;
    // 人形专属词一个都不能有——给猫写「双臂离开身体以分离轮廓」，出来的是人形猫
    expect(prompt).not.toMatch(/standing/i);
    expect(prompt).not.toMatch(/arms/i);
    expect(prompt).not.toMatch(/above the head/i);
    expect(prompt).not.toMatch(/face/i);
    // 但通用构图与画风约束还在，抠底靠的就是这层
    expect(prompt).toMatch(/entire subject fully inside the frame/i);
    expect(prompt).toMatch(/pure white background/i);
  });

  it("full/half（人）保留人形姿势词：抠底要轮廓分得开", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral", framing: "full" }, "a girl");
    const prompt = calls[0]!.prompt;
    expect(prompt).toMatch(/standing pose/i);
    expect(prompt).toMatch(/arms held slightly away/i);
    expect(prompt).toMatch(/above the head/i);
  });

  it("立绘取景：play.json 角色上声明的取景会被沿用，不必每次都传", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [{ id: "mio", name: "澪", persona: "", framing: "half" }],
    });
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "p");
    expect(calls[0]!.aspectRatio).toBe("3:4");
  });

  it("立绘取景：差分上的覆盖优先于角色声明，出图后回写 play.json", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [{ id: "mio", name: "澪", persona: "", framing: "full", spriteFraming: { wow: "square" } }],
    });
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "wow" }, "p");
    // 第 0 次调用是自动补的定妆照：它按**角色级**取景出，不按这条差分的 square
    expect(calls[0]!.aspectRatio).toBe("9:16");
    expect(calls[1]!.aspectRatio).toBe("1:1");
    const play = JSON.parse(await files.read("play.json")) as {
      characters: { framing?: string; spriteFraming?: Record<string, string> }[];
    };
    expect(play.characters[0]!.spriteFraming).toEqual({ neutral: "full", wow: "square" });
    // 差分覆盖只是覆盖，角色级声明不能被一张差分带走
    expect(play.characters[0]!.framing).toBe("full");
  });

  it("立绘取景：中性定妆照同时立角色级默认，取景随之落进角色卡", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral", framing: "half" }, "p");
    const play = JSON.parse(await files.read("play.json")) as {
      characters: { framing?: string; spriteFraming?: Record<string, string> }[];
    };
    expect(play.characters[0]!.framing).toBe("half");
    expect(play.characters[0]!.spriteFraming).toEqual({ neutral: "half" });
  });

  it("立绘取景：差分的提示词也带景别，否则垫图（全身）会把方形主体拖回人形", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral", framing: "square" }, "a cat");
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "sleepy", framing: "square" }, "sleepy");
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
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [
        { id: "mio", name: "澪", persona: "" },
        { id: "Koharu", name: "小春", persona: "" },
      ],
    });
    for (const id of ["mio", "Koharu"]) {
      await assets.generate({ kind: "sprite", characterId: id, expression: "neutral" }, "p");
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
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [
        { id: "mio", name: "澪", persona: "" },
        { id: "Koharu", name: "小春", persona: "" },
      ],
    });
    for (const id of ["mio", "Koharu"]) {
      await assets.generate({ kind: "sprite", characterId: id, expression: "neutral" }, "p");
    }
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["Koharu", "mio"] }, "p");
    expect(calls[0]!.prompt).toMatch(/in this exact order: 1\) 小春, 2\) 澪/);
  });

  it("CG 参考立绘：没有 neutral 也能垫，退回该角色任意一张差分", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    // 该角色只有 smile、根本没有 neutral：映射与盘上的文件都要对上，只改一个不算数
    await mkdir(files.absoluteOf("assets/sprites/mio"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mio/smile.png"), await realImage("9:16", "image/png"));
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [{ id: "mio", name: "澪", persona: "", sprites: { smile: "smile.png" } }],
    });
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio"] }, "p");
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.prompt).toMatch(/1\) 澪/);
  });

  it("CG 参考立绘：点名了但那个角色没立绘，直接报错不出一张少人的图", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await expect(
      assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["Koharu"] }, "p"),
    ).rejects.toThrow(/角色「小春」（Koharu）还没有立绘/);
    expect(calls).toHaveLength(0);
    expect(existsSync(files.absoluteOf("assets/cg/rooftop.jpg"))).toBe(false);
  });

  it("CG 参考立绘：角色不在角色表时报错并列出可选 id，不静默丢弃", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await expect(
      assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio", "ghost"] }, "p"),
    ).rejects.toThrow(/play.json 里没有角色「ghost」/);
  });

  it("CG 参考立绘：映射里的文件名不等于差分名时照样找得到（breezy_oak 的 grin → oak_grin2.png）", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await mkdir(files.absoluteOf("assets/sprites/mio"), { recursive: true });
    await writeFile(files.absoluteOf("assets/sprites/mio/oak_grin2.png"), await realImage("9:16", "image/png"));
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [{ id: "mio", name: "澪", persona: "", sprites: { grin: "oak_grin2.png" } }],
    });
    calls.length = 0;
    // 按差分名去找会判成「没有立绘」——文件并不叫 grin.png
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio"] }, "p");
    expect(calls[0]!.references).toHaveLength(1);
    expect(calls[0]!.prompt).toMatch(/1\) 澪/);
  });

  it("CG 参考立绘：映射里的文件名带路径分隔符时不认（路径穿越不因为是映射就放行）", async () => {
    const store = await makeStore();
    const { backend } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await store.savePlay({
      ...(await store.loadPlay()),
      characters: [{ id: "mio", name: "澪", persona: "", sprites: { smile: "../../play.json" } }],
    });
    await expect(
      assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio"] }, "p"),
    ).rejects.toThrow(/还没有立绘/);
  });

  it("CG 参考立绘：STAGE_IMAGE_REFERENCE=none 是全局开关，显式点名也一样不发", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend, 2, "none");
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "p");
    calls.length = 0;
    await assets.generate({ kind: "cg", name: "rooftop", referenceCharacters: ["mio"] }, "p");
    expect(calls[0]!.references).toEqual([]);
    // 开关关掉垫图，但提示词里的序号锚点不能留着——没有图就没有「第几张」
    expect(calls[0]!.prompt).not.toMatch(/in this exact order/);
  });

  it("画幅回执：模型回的画幅不对就报错，一个字节都不落盘", async () => {
    const store = await makeStore();
    // 实测 flow2api 对 3:4/4:3 静默出 1200x896 横图——立绘拿到横图等于站位崩
    const backend: ImageBackend = { generate: async () => ({ data: png(1200, 896), mimeType: "image/png" }) };
    const { assets, files } = makeAssets(store, backend);
    await expect(
      assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "p"),
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

  it("素材名与差分名按文件名白名单校验，角色 id 走 play.json 成员校验（大小写不限）", async () => {
    const store = await makeStore();
    const { assets } = makeAssets(store, stubBackend().backend);

    await expect(assets.generate({ kind: "background", name: "../escape" }, "p")).rejects.toThrow(/非法/);
    await expect(assets.generate({ kind: "background" }, "p")).rejects.toThrow(/必须给 name/);
    await expect(assets.generate({ kind: "sprite", characterId: "mio" }, "p")).rejects.toThrow(/必须给 expression/);
    await expect(assets.generate({ kind: "sprite", characterId: "nobody", expression: "smile" }, "p")).rejects.toThrow(
      /没有角色「nobody」/,
    );
    // 角色 id 不走文件名正则：play.json 里的 Koharu 完全合法
    const out = await assets.generate({ kind: "sprite", characterId: "Koharu", expression: "smile" }, "p");
    expect(out.at(-1)!.path).toBe("assets/sprites/Koharu/smile.png");
  });

  it("临时角色：剧作家给 characterName 就自动注册 stub；工坊侧不给名字仍按成员校验报错", async () => {
    const store = await makeStore();
    const { assets, files, writes } = makeAssets(store, stubBackend().backend);

    // 工坊（notify 缺省）：角色表是用户与工坊的账，一次出图不该悄悄塞进陌生人
    await expect(
      assets.generate({ kind: "sprite", characterId: "ran", expression: "neutral" }, "p", undefined, undefined, {
        characterName: "岚",
      }),
    ).rejects.toThrow(/没有角色「ran」/);

    // 剧作家（notify=silent + characterName）：临时角色边出边注册，回到角色表与差分映射
    const out = await assets.generate({ kind: "sprite", characterId: "ran", expression: "neutral" }, "p", undefined, undefined, {
      notify: "silent",
      characterName: "岚",
    });
    expect(out.at(-1)!.path).toBe("assets/sprites/ran/neutral.png");
    const config = JSON.parse(await readFile(join(store.dir, "play.json"), "utf8"));
    expect(config.characters.map((c: { id: string }) => c.id)).toContain("ran");
    expect(config.characters.find((c: { id: string }) => c.id === "ran")).toMatchObject({
      name: "岚",
      sprites: { neutral: "neutral.png" },
    });
    expect(writes.some((w) => w.path === "play.json")).toBe(true);

    // 静默出图不给名字：模型不知道自己在给谁画，宁可报错让它把名字补上
    await expect(
      assets.generate({ kind: "sprite", characterId: "sora", expression: "neutral" }, "p", undefined, undefined, {
        notify: "silent",
      }),
    ).rejects.toThrow(/没有角色「sora」/);
  });

  it("STAGE_IMAGE_REFERENCE=none：差分走纯文生图，不带参考图（定妆照照样自动补）", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend, 2, "none");

    const out = await assets.generate({ kind: "sprite", characterId: "mio", expression: "smile" }, "少女");

    expect(out.at(-1)!.path).toBe("assets/sprites/mio/smile.png");
    // 定妆照是合法差分（actor 能直接引用），自动补一张；两次出图都不带垫图
    expect(calls).toHaveLength(2);
    expect(calls[0]!.references).toEqual([]);
    expect(calls[1]!.references).toEqual([]);
    expect(existsSync(files.absoluteOf("assets/sprites/mio/neutral.png"))).toBe(true);
  });

  it("差分自动先定妆照：垫图带上、提示词锁身份，play.json 立绘映射一并补写", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files, writes } = makeAssets(store, backend);

    const out = await assets.generate({ kind: "sprite", characterId: "mio", expression: "smile" }, "少女");
    // 返回 [自动定的 neutral, 用户点名的 smile]：两张都是真金白银出的，都得交出去
    expect(out.map((a) => a.path)).toEqual(["assets/sprites/mio/neutral.png", "assets/sprites/mio/smile.png"]);
    expect(out.at(-1)!.autoNeutral).toBe(true);
    // 先 neutral 后差分，两次出图
    expect(calls).toHaveLength(2);
    expect(calls[0]!.references).toEqual([]);
    expect(calls[0]!.prompt).toContain("neutral expression");
    // 垫图就是盘上那张抠过底的定妆照
    expect(calls[1]!.references).toHaveLength(1);
    expect(calls[1]!.references![0]!.mimeType).toBe("image/png");
    expect(calls[1]!.references![0]!.data.equals(await readFile(files.absoluteOf("assets/sprites/mio/neutral.png")))).toBe(
      true,
    );
    expect(calls[1]!.prompt).toContain("Same character as the reference image");

    const play = JSON.parse(await readFile(files.absoluteOf("play.json"), "utf8"));
    expect(play.characters.find((c: { id: string }) => c.id === "mio").sprites).toEqual({
      neutral: "neutral.png",
      smile: "smile.png",
    });
    // 立绘映射补写要可撤销
    expect(writes).toHaveLength(2);
    expect(writes[0]!.path).toBe("play.json");
    expect(writes[0]!.before).toContain("测试角色");
  });

  it("并发出两个差分：play.json 的立绘映射不能互相冲掉", async () => {
    const store = await makeStore();
    // 预生成一次、每次都返回同一份字节：让两个差分在同一个 tick 冲到 mapSprite。
    // 每次现生成的话 sharp 是 CPU 密集的，两条流水线会自然错开，撞不出丢失更新。
    const data = await realImage("9:16", "image/jpeg");
    const { assets, files } = makeAssets(store, {
      generate: async () => ({ data, mimeType: "image/jpeg" }),
    });
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "少女");

    // 把"后写的覆盖先写的"这个窗口撑开：两个 read 都到齐就立刻放行（无锁时必丢更新），
    // 到不齐就等 150ms 兜底（有锁时两次 read 天然串行，这里只是白等一会儿，不会挂死）
    const realRead = files.read.bind(files);
    let arrivals = 0;
    let release = (): void => {};
    const bothArrived = new Promise<void>((r) => (release = r));
    const timeout = setTimeout(release, 150);
    files.read = async (path: string) => {
      if (path === "play.json" && ++arrivals <= 2) {
        await bothArrived;
        if (arrivals >= 2) release();
      }
      return realRead(path);
    };

    // 两个 read-modify-write 真并发
    const [smile, sad] = await Promise.all([
      assets.generate({ kind: "sprite", characterId: "mio", expression: "smile" }, "少女"),
      assets.generate({ kind: "sprite", characterId: "mio", expression: "sad" }, "少女"),
    ]);
    expect(smile.at(-1)!.path).toBe("assets/sprites/mio/smile.png");
    expect(sad.at(-1)!.path).toBe("assets/sprites/mio/sad.png");

    const play = JSON.parse(await readFile(files.absoluteOf("play.json"), "utf8"));
    expect(play.characters.find((c: { id: string }) => c.id === "mio").sprites).toEqual({
      neutral: "neutral.png",
      smile: "smile.png",
      sad: "sad.png",
    });
    clearTimeout(timeout);
  });

  it("已有 neutral 时直接派生，不重复定妆", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "少女");
    const [res] = await assets.generate({ kind: "sprite", characterId: "mio", expression: "sad" }, "少女");
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
    await expect(assets.generate({ kind: "sprite", characterId: "mio", expression: "angry" }, "少女")).rejects.toThrow(
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
      names.map((expression) => assets.generate({ kind: "sprite", characterId: "mio", expression }, "少女")),
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
    const play = JSON.parse(await readFile(files.absoluteOf("play.json"), "utf8"));
    const sprites = play.characters.find((c: { id: string }) => c.id === "mio").sprites;
    expect(Object.keys(sprites).sort()).toEqual(["angry", "neutral", "sad", "shy", "smile", "surprised", "thinking"]);
    // 7 次出图各自要走一遍抠底（768x1365，实测单次 ~850ms），默认 5s 只够跑一半，
    // 流水线上任何一点扰动都会翻成假红。这条测的是去重语义，不是性能，给足预算。
  }, 30_000);
});

describe("PlayAssets：出图留痕", () => {
  it("prompt 记进 assets/generated.json：立绘用 <角色id>/<差分名> 键，背景用文件名主体", async () => {
    const store = await makeStore();
    const { backend, calls } = stubBackend();
    const { assets, files } = makeAssets(store, backend);
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "少女");
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
    // 一张表一个写者：素材描述表归工坊与用户，出图不许碰它
    expect(existsSync(files.absoluteOf("assets/manifest.json"))).toBe(false);
  });

  it("台账不与工坊的描述表互相覆盖：各写各的", async () => {
    const store = await makeStore();
    await mkdir(join(store.dir, "assets"), { recursive: true });
    await writeFile(join(store.dir, "assets", "manifest.json"), JSON.stringify({ neutral: "工坊写的描述" }));
    const { assets, files } = makeAssets(store, stubBackend().backend);
    await assets.generate({ kind: "sprite", characterId: "mio", expression: "neutral" }, "少女");

    expect(JSON.parse(await readFile(files.absoluteOf("assets/manifest.json"), "utf8")).neutral).toBe("工坊写的描述");
    expect(JSON.parse(await readFile(files.absoluteOf("assets/generated.json"), "utf8"))["mio/neutral"].prompt).toBeTruthy();
  });

  it("并发出 6 个差分：台账一条都不许被后写的冲掉", async () => {
    const store = await makeStore();
    const { assets, files } = makeAssets(store, stubBackend().backend);
    await Promise.all(
      ["normal", "smile", "shy", "angry", "sad", "surprised"].map((expression) =>
        assets.generate({ kind: "sprite", characterId: "mio", expression }, "少女"),
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
      { kind: "sprite", characterId: "mio", expression: "neutral" },
      "a girl with pink long straight hair down to her waist",
    );
    // 后缀里的每个词都会被当成设定印进图里：这里曾写着「between the twin tails」，
    // 于是所有角色都长出双马尾——prompt 明写 long straight hair 也救不回来。
    const sent = calls[0]!.prompt;
    expect(sent).toContain("clear empty white space between the arms and the body");
    expect(sent.toLowerCase()).not.toMatch(/twin|tail|braid|ponytail/);
  });
});
