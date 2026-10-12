import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyUiImageGen } from "../src/index.js";

const COMFY_OPTS = {
  baseUrl: "http://127.0.0.1:8188",
  model: "sd_xl_base_1.0.safetensors",
  size: "1K",
  timeoutMs: 1000,
};

const PROMPT_ID = "p-1";

/** 1x1 PNG 的字节头——`/view` 回的产物，`sniffImageMime` 靠它认类型。 */
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** `/history` 里跑完的那一条（键就是提示 id）。 */
const historyDone = (filename: string) => ({
  [PROMPT_ID]: {
    outputs: { save: { images: [{ filename, subfolder: "", type: "output" }] } },
    status: { status_str: "success", completed: true, messages: [] },
  },
});

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array };
}

/** 上传垫图时 ComfyUI 回的名字——`LoadImage.image` 用的就是它（可能与上传的文件名不同）。 */
const UPLOADED_NAME = "aivn-ref-1.png";

const uploadOk = () =>
  new Response(JSON.stringify({ name: UPLOADED_NAME, subfolder: "", type: "input" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** 四步假服务：`/upload/image` 回 name，`/prompt` 回 id，`/history` 按给的序列逐次回，`/view` 回字节。 */
function fakeComfy(
  history: unknown[],
  calls: Call[],
  view = () => new Response(PNG_HEAD, { status: 200, headers: { "content-type": "image/png" } }),
  upload: () => Response = uploadOk,
) {
  let poll = 0;
  return (async (url: string, init: Call["init"]) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/upload/image")) return upload();
    if (String(url).endsWith("/prompt")) {
      return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
    }
    if (String(url).includes("/history/")) {
      const body = history[Math.min(poll, history.length - 1)];
      poll += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (String(url).includes("/view?")) return view();
    // 严格分流：多出来的请求直接炸，别让假服务把任何请求都当 /view 收下
    throw new Error(`假服务不认识这个请求：${String(url)}`);
  }) as never;
}

/** `/prompt` 的 body 是 JSON 串；垫图上传那份是 multipart 字节，取错类型就该炸。 */
function jsonBody(call: Call): string {
  if (typeof call.init.body !== "string") throw new Error(`这个请求的 body 不是 JSON 串：${call.url}`);
  return call.init.body;
}

/** 上传请求的 multipart 实体——字段名、文件名、分段类型都从这里查。 */
function multipartOf(call: Call): { boundary: string; text: string; raw: Buffer } {
  if (!(call.init.body instanceof Uint8Array)) throw new Error(`这个请求的 body 不是字节：${call.url}`);
  const contentType = call.init.headers?.["content-type"] ?? "";
  const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) throw new Error(`content-type 里没有 boundary：${contentType}`);
  const raw = Buffer.from(call.init.body);
  return { boundary, text: raw.toString("latin1"), raw };
}

const refBytes = (head: string, size = 32) => Buffer.concat([Buffer.from(head, "hex"), Buffer.alloc(size)]);

/** 1x1 PNG（够长到能被 sniff 认出）。 */
const PNG_REF = refBytes("89504e470d0a1a0a0000000d49484452");

const noSleep = async () => {};

afterEach(() => {
  vi.useRealTimers();
});

describe("ComfyUiImageGen：ComfyUI 原生 API 生图", () => {
  it("三步走通：提交 API 格式工作流 → 轮询 history → view 取字节", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("aivn_00001_.png")], calls), noSleep);

    const image = await gen.generate({ prompt: "1girl, classroom", aspectRatio: "16:9" });

    expect(calls[0]!.url).toBe("http://127.0.0.1:8188/prompt");
    expect(calls[0]!.init.method).toBe("POST");
    const graph = JSON.parse(jsonBody(calls[0]!)) as {
      prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    };
    // checkpoint 名来自配置、提示词进正向、空 latent 按画幅与档位换算（1K / 16:9 → 两边对齐 8）
    expect(graph.prompt.ckpt).toEqual({
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" },
    });
    expect(graph.prompt.positive!.inputs).toMatchObject({ text: "1girl, classroom", clip: ["ckpt", 1] });
    expect(graph.prompt.negative!.inputs).toMatchObject({ text: "" });
    expect(graph.prompt.latent!.inputs).toMatchObject({ width: 1368, height: 768, batch_size: 1 });
    // 采样器连线：模型 / 正负提示词 / 空 latent 各自从对应节点来
    expect(graph.prompt.sampler!.inputs).toMatchObject({
      model: ["ckpt", 0],
      positive: ["positive", 0],
      negative: ["negative", 0],
      latent_image: ["latent", 0],
      steps: 20,
      cfg: 8,
      sampler_name: "euler",
      scheduler: "normal",
    });
    expect(graph.prompt.decode!.inputs).toMatchObject({ samples: ["sampler", 0], vae: ["ckpt", 2] });

    expect(calls[1]!.url).toBe(`http://127.0.0.1:8188/history/${PROMPT_ID}`);
    expect(calls[2]!.url).toBe("http://127.0.0.1:8188/view?filename=aivn_00001_.png&type=output");
    expect(image.data.equals(PNG_HEAD)).toBe(true);
    expect(image.mimeType).toBe("image/png");
  });

  it("排队中要接着轮询：history 里没这条 → 只有 outputs 没图 → 跑完才收工", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy(
        [
          {},
          { [PROMPT_ID]: { outputs: {}, status: { status_str: "success", completed: false } } },
          historyDone("aivn_00002_.png"),
        ],
        calls,
      ),
      noSleep,
    );

    await gen.generate({ prompt: "a" });

    expect(calls.filter((call) => call.url.includes("/history/"))).toHaveLength(3);
    expect(calls.at(-1)!.url).toContain("/view?filename=aivn_00002_.png");
  });

  it("子目录的产物把 subfolder 带上（不带就取不到那张图）", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy(
        [{ [PROMPT_ID]: { outputs: { save: { images: [{ filename: "x.png", subfolder: "2026-10", type: "temp" }] } } } }],
        calls,
      ),
      noSleep,
    );

    await gen.generate({ prompt: "a" });

    expect(calls.at(-1)!.url).toBe("http://127.0.0.1:8188/view?filename=x.png&type=temp&subfolder=2026-10");
  });

  it("响应头与字节冲突时以字节为准（反代与预览端点会给错类型）", async () => {
    const gen = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy([historyDone("a.png")], [], () => new Response(PNG_HEAD, { status: 200, headers: { "content-type": "image/webp" } })),
      noSleep,
    );

    expect((await gen.generate({ prompt: "a" })).mimeType).toBe("image/png");
  });

  it("200 但不是图片就报错，绝不把错误页当素材交出去", async () => {
    const asJson = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy([historyDone("a.png")], [], () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
      noSleep,
    );
    await expect(asJson.generate({ prompt: "a" })).rejects.toThrow(/ComfyUI \/view 回来的不是图片（a\.png，2 字节/);

    const empty = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], [], () => new Response("")), noSleep);
    await expect(empty.generate({ prompt: "a" })).rejects.toThrow(/回来的不是图片/);
  });

  it("/view 取不到那张图（404）时报出来，不拿空字节往下走", async () => {
    const gen = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy([historyDone("gone.png")], [], () => new Response("not found", { status: 404 })),
      noSleep,
    );

    await expect(gen.generate({ prompt: "a" })).rejects.toThrow("ComfyUI /view 取图失败 HTTP 404（gone.png）");
  });

  it("产物名里的空格按表单编码发出去（ComfyUI 侧按 + 解回空格）", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("out 1.png")], calls), noSleep);

    await gen.generate({ prompt: "a" });

    expect(calls.at(-1)!.url).toBe("http://127.0.0.1:8188/view?filename=out+1.png&type=output");
  });

  it("/prompt 400：节点级校验失败要带出节点号与该节点的每条原因", async () => {
    const gen = new ComfyUiImageGen(
      COMFY_OPTS,
      (async () =>
        new Response(
          JSON.stringify({
            error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
            node_errors: {
              ckpt: { errors: [{ message: "Value not in list: ckpt_name" }, { message: "checkpoint 文件不存在" }] },
              latent: { errors: [{ message: "width must be a multiple of 8" }] },
            },
          }),
          { status: 400 },
        )) as never,
      noSleep,
    );

    await expect(gen.generate({ prompt: "a" })).rejects.toThrow(
      "ComfyUI /prompt 被拒 HTTP 400：Prompt outputs failed validation；" +
        "节点 ckpt：Value not in list: ckpt_name；checkpoint 文件不存在；节点 latent：width must be a multiple of 8",
    );
  });

  it("执行期失败：status_str=error 就报错，不当成「还在跑」", async () => {
    const gen = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy(
        [
          {
            [PROMPT_ID]: {
              outputs: {},
              status: {
                status_str: "error",
                completed: false,
                // 原因那一条后面还有别的事件：只看最后一条就只剩「没有错误详情」
                messages: [
                  ["execution_error", { node_type: "KSampler", node_id: "sampler", exception_message: "CUDA out of memory" }],
                  ["execution_interrupted", { node_type: "KSampler", node_id: "sampler" }],
                ],
              },
            },
          },
        ],
        [],
      ),
      noSleep,
    );

    await expect(gen.generate({ prompt: "a" })).rejects.toThrow("ComfyUI 出图失败：KSampler sampler：CUDA out of memory");
  });

  it("一直没跑完就按超时报错（超时是排队 + 出图的总预算）", async () => {
    const gen = new ComfyUiImageGen({ ...COMFY_OPTS, timeoutMs: 0 }, fakeComfy([{}], []), noSleep);

    await expect(gen.generate({ prompt: "a" })).rejects.toThrow(/ComfyUI 出图超时（0s）：prompt p-1 还没跑完/);
  });

  it("总预算不随请求数翻倍：提交 + 每次轮询吃同一份 timeoutMs", async () => {
    vi.useFakeTimers();
    const slept: number[] = [];
    // /prompt 先花掉 500ms（入队也要时间），预算必须从**提交之前**算起
    const gen = new ComfyUiImageGen({ ...COMFY_OPTS, timeoutMs: 3000 }, (async (url: string) => {
      if (String(url).endsWith("/prompt")) {
        vi.advanceTimersByTime(500);
        return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as never, async (ms) => {
      slept.push(ms);
      vi.advanceTimersByTime(ms);
    });

    await expect(gen.generate({ prompt: "a" })).rejects.toThrow(/ComfyUI 出图超时（3s）/);
    // 提交 500 + 两次整觉 + 最后一觉只睡剩下的 500 = 到点即止，不越过 3000ms
    expect(slept).toEqual([1000, 1000, 500]);
  });

  it("尺寸：字面像素原样发出，但不是 8 的倍数就报错（latent 会悄悄截断）", async () => {
    const calls: Call[] = [];
    const literal = new ComfyUiImageGen({ ...COMFY_OPTS, size: "1536x1024" }, fakeComfy([historyDone("a.png")], calls), noSleep);
    await literal.generate({ prompt: "a" });
    const graph = JSON.parse(jsonBody(calls[0]!)) as { prompt: { latent: { inputs: Record<string, number> } } };
    expect(graph.prompt.latent.inputs).toMatchObject({ width: 1536, height: 1024 });

    const odd = new ComfyUiImageGen({ ...COMFY_OPTS, size: "1500x1000" }, fakeComfy([historyDone("a.png")], []), noSleep);
    await expect(odd.generate({ prompt: "a" })).rejects.toThrow(/不是 8 的倍数/);
  });

  it("剧目覆盖：req.model / req.size 优先于部署配置", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], calls), noSleep);

    await gen.generate({ prompt: "a", model: "pdxl.safetensors", size: "2K", aspectRatio: "9:16" });

    const graph = JSON.parse(jsonBody(calls[0]!)) as {
      prompt: { ckpt: { inputs: { ckpt_name: string } }; latent: { inputs: Record<string, number> } };
    };
    expect(graph.prompt.ckpt.inputs.ckpt_name).toBe("pdxl.safetensors");
    expect(graph.prompt.latent.inputs).toMatchObject({ width: 1536, height: 2728 });
  });

  it("没带垫图就是原样的文生图：空 latent，模板里一个 LoadImage 都不该有", async () => {
    const calls: Call[] = [];
    await new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], calls), noSleep).generate({ prompt: "a" });

    const graph = JSON.parse(jsonBody(calls[0]!)) as { prompt: Record<string, { class_type: string }> };
    expect(graph.prompt.latent!.class_type).toBe("EmptyLatentImage");
    expect(Object.values(graph.prompt).map((node) => node.class_type)).not.toContain("LoadImage");
    expect(calls).toHaveLength(3); // 提交 → history → view，没有多出来的上传
  });

  it("一张垫图走图生图：先传字节，再 LoadImage → ImageScale → VAEEncode 喂给采样器", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("out.png")], calls), noSleep);

    const image = await gen.generate({
      prompt: "1girl, smile",
      aspectRatio: "16:9",
      references: [{ mimeType: "image/png", data: PNG_REF }],
    });

    // 上传排在提交之前：LoadImage 要的是上传后 ComfyUI 侧的真名
    expect(calls[0]!.url).toBe("http://127.0.0.1:8188/upload/image");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[1]!.url).toBe("http://127.0.0.1:8188/prompt");

    const graph = JSON.parse(jsonBody(calls[1]!)) as {
      prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    };
    // 空 latent 被换掉了——还留着它就是把垫图白传
    expect(graph.prompt.latent).toBeUndefined();
    expect(graph.prompt.load).toEqual({ class_type: "LoadImage", inputs: { image: UPLOADED_NAME } });
    // 缩到目标画布（1K / 16:9 → 1368x768，与 txt2img 同一份 canvas()），中心裁切不拉伸
    expect(graph.prompt.scale).toEqual({
      class_type: "ImageScale",
      inputs: { image: ["load", 0], upscale_method: "lanczos", width: 1368, height: 768, crop: "center" },
    });
    expect(graph.prompt.encode).toEqual({
      class_type: "VAEEncode",
      inputs: { pixels: ["scale", 0], vae: ["ckpt", 2] },
    });
    expect(graph.prompt.sampler!.inputs).toMatchObject({
      latent_image: ["encode", 0],
      denoise: 0.6,
      model: ["ckpt", 0],
      positive: ["positive", 0],
      negative: ["negative", 0],
      steps: 20,
      cfg: 8,
    });
    expect(graph.prompt.decode!.inputs).toMatchObject({ samples: ["sampler", 0], vae: ["ckpt", 2] });
    expect(graph.prompt.save!.inputs).toMatchObject({ images: ["decode", 0] });
    expect(image.mimeType).toBe("image/png");
  });

  it("上传的 multipart 形状：字段名 image、头与体同一个 boundary、文件名按真实字节定扩展名", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], calls), noSleep);
    // 入参说是 JPEG，字节是 PNG：文件名与分段类型都得按字节走
    const ref = { mimeType: "image/jpeg", data: PNG_REF };

    await gen.generate({ prompt: "a", references: [ref] });

    const call = calls[0]!;
    const { boundary, text, raw } = multipartOf(call);
    // boundary 出自实体自己那一份（FormData 生成），头里的与体里的必须一致
    expect(raw.subarray(0, boundary.length + 2).toString("latin1")).toBe(`--${boundary}`);
    expect(text).toMatch(
      new RegExp(`Content-Disposition: form-data; name="image"; filename="aivn-ref-\\d+-[a-z0-9]+\\.png"`),
    );
    expect(text).toContain("Content-Type: image/png");
    expect(text).toMatch(/Content-Disposition: form-data; name="type"[\s\S]*\r\n\r\ninput\r\n/);
    expect(raw.includes(PNG_REF)).toBe(true); // 垫图字节原样在实体里
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
    // 没配 Key 就不带鉴权头（content-type 是这条请求唯一的头）
    expect(call.init.headers).toEqual({ "content-type": `multipart/form-data; boundary=${boundary}` });

    // 第二次上传不能撞同一个名字（ComfyUI 撞名会自己改名，那就不叫「唯一」了）
    await gen.generate({ prompt: "a", references: [ref] });
    const again = multipartOf(calls[4]!);
    expect(again.text).not.toBe(text);
    expect(again.boundary).not.toBe(boundary);
  });

  it("认不出字节的垫图在上传前就拒（入参 mimeType 说了不算）", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], calls), noSleep);

    await expect(
      gen.generate({ prompt: "a", references: [{ mimeType: "image/png", data: Buffer.from("not an image") }] }),
    ).rejects.toThrow(/垫图认不出字节类型（12 字节，入参写的是 image\/png）/);
    expect(calls).toHaveLength(0);
  });

  it("两张垫图直接拒，不静默取第一张（少垫一张只会画错人）", async () => {
    const calls: Call[] = [];
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], calls), noSleep);
    const ref = { mimeType: "image/png", data: PNG_REF };

    await expect(gen.generate({ prompt: "a", references: [ref, ref] })).rejects.toThrow(
      /一次只垫一张参考图（这次给了 2 张）/,
    );
    expect(calls).toHaveLength(0);
  });

  it("上传失败要当场报出来，带响应片段，不再往下走 /prompt", async () => {
    const rejected = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy([historyDone("a.png")], [], undefined, () => new Response("no image", { status: 400 })),
      noSleep,
    );
    await expect(rejected.generate({ prompt: "a", references: [{ mimeType: "image/png", data: PNG_REF }] })).rejects.toThrow(
      "ComfyUI /upload/image 上传失败 HTTP 400：no image",
    );

    const notJson = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy([historyDone("a.png")], [], undefined, () => new Response("<html>oops</html>", { status: 200 })),
      noSleep,
    );
    await expect(notJson.generate({ prompt: "a", references: [{ mimeType: "image/png", data: PNG_REF }] })).rejects.toThrow(
      "ComfyUI /upload/image 没有回 name：<html>oops</html>",
    );

    // 200 但没 name：照样是错，不能拿空串去当 LoadImage 的入参
    const noName = new ComfyUiImageGen(
      COMFY_OPTS,
      fakeComfy([historyDone("a.png")], [], undefined, () => new Response("{}", { status: 200 })),
      noSleep,
    );
    await expect(noName.generate({ prompt: "a", references: [{ mimeType: "image/png", data: PNG_REF }] })).rejects.toThrow(
      "ComfyUI /upload/image 没有回 name：{}",
    );
  });

  it("上传与出图共用同一份预算：上传花掉的 500ms 从轮询里扣", async () => {
    vi.useFakeTimers();
    const slept: number[] = [];
    const gen = new ComfyUiImageGen(
      { ...COMFY_OPTS, timeoutMs: 3000 },
      (async (url: string) => {
        if (String(url).endsWith("/upload/image")) {
          vi.advanceTimersByTime(500);
          return uploadOk();
        }
        if (String(url).endsWith("/prompt")) {
          vi.advanceTimersByTime(500);
          return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as never,
      async (ms) => {
        slept.push(ms);
        vi.advanceTimersByTime(ms);
      },
    );

    await expect(gen.generate({ prompt: "a", references: [{ mimeType: "image/png", data: PNG_REF }] })).rejects.toThrow(
      /ComfyUI 出图超时（3s）/,
    );
    // 上传 + 提交吃掉 1000ms，剩下的两觉正好把预算用完（另外起一份预算就会多睡）
    expect(slept).toEqual([1000, 1000]);
  });

  it("画幅白名单：不在表里的画幅在发请求之前就拒", async () => {
    const gen = new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], []), noSleep);

    await expect(gen.generate({ prompt: "a", aspectRatio: "1:4" as never })).rejects.toThrow(/画幅（1:4）不受支持/);
  });

  it("鉴权头：给了 key 才带 Bearer，没给就不带（ComfyUI 本身不校验）", async () => {
    const withKey: Call[] = [];
    await new ComfyUiImageGen({ ...COMFY_OPTS, apiKey: "test-key" }, fakeComfy([historyDone("a.png")], withKey), noSleep).generate({
      prompt: "a",
    });
    expect(withKey[0]!.init.headers).toMatchObject({ authorization: "Bearer test-key" });

    const noKey: Call[] = [];
    await new ComfyUiImageGen(COMFY_OPTS, fakeComfy([historyDone("a.png")], noKey), noSleep).generate({ prompt: "a" });
    expect(noKey[0]!.init.headers).not.toHaveProperty("authorization");
  });
});
