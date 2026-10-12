import { defaultFetch, type FetchLike } from "../http.js";
import {
  extOf,
  IMAGE_ASPECTS,
  imageSizeText,
  parseImageSize,
  sniffImageMime,
  tierCanvasFor,
  type GeneratedImage,
  type ImageAspect,
  type ImageBackend,
  type ImageRequest,
  type ImageSizeSpec,
} from "./image.js";

/**
 * ComfyUI 原生 API 生图（`POST {base}/prompt` → 轮询 `GET {base}/history/{prompt_id}` → `GET {base}/view`）。
 *
 * ComfyUI 的 `/prompt` 是**异步**的：入队就回 `prompt_id`，完成态只在 `/history` 里，产物再从
 * `/view?filename=…` 取字节。所以一次出图是「提交 → 轮询 → 取图」三步，`timeoutMs` 是**排队 + 出图**
 * 的总预算（不是单个请求的超时）。
 *
 * 提交的是**API 格式**的工作流（`{nodeId: {class_type, inputs}}`），不是界面侧栏读的 UI 格式
 * （`{nodes, links}`）。带不带垫图是两份模板，其余节点一模一样：
 *
 *     文生图：CheckpointLoaderSimple → CLIPTextEncode ×2 → EmptyLatentImage → KSampler → VAEDecode → SaveImage
 *     图生图：CheckpointLoaderSimple → CLIPTextEncode ×2 → LoadImage → ImageScale → VAEEncode → KSampler → VAEDecode → SaveImage
 *
 * 采样参数（`steps 20 / cfg 8 / euler / normal`，种子每次随机）照官方模板**写死**；图生图的
 * `denoise` 另外写死 0.6——本层没有这些配置项，要改就改这两份模板。
 *
 * 三处口径（都跟别的格式对齐，别当「换个 baseUrl 的 openai」）：
 *
 * - **垫图只吃一张**：先 `POST /upload/image` 上传字节，拿回 `name` 喂给 `LoadImage`，再用 `ImageScale`
 *   把垫图缩到目标画布（中心裁切，不拉伸）、`VAEEncode` 编成 latent。给多张直接报错，不静默取第一张
 *   （少垫一张不会报错、只会画错人）。上传与出图共用同一份 `timeoutMs`。
 * - **`model` 是 checkpoint 文件名**（`CheckpointLoaderSimple.ckpt_name`），不是模型别名。
 * - **尺寸要能被 8 整除**：latent 以 8 像素为一格，字面像素不是 8 的倍数时 ComfyUI 会**悄悄截断**
 *   （回图尺寸与要的对不上，而 12% 的画幅容差察觉不到），所以发之前就判掉；档位则由
 *   `tierCanvasFor` 按总像素量级换算、两边对齐到 8。
 */

export interface ComfyUiImageOptions {
  /** ComfyUI 根地址（如 `http://127.0.0.1:8188`），后面直接拼 `/prompt` `/history` `/view`。 */
  baseUrl: string;
  /** 不给就不带鉴权头（ComfyUI 本身没有鉴权，反代要求 Bearer 时给）。 */
  apiKey?: string;
  /** checkpoint 文件名（`CheckpointLoaderSimple.ckpt_name`）。 */
  model: string;
  /** 配置里的尺寸原文：档位或字面像素，构造期解析。 */
  size: string;
  timeoutMs: number;
}

/** latent 的最小单位：EmptyLatentImage 的宽高都会被解释成「几格 × 8 像素」。 */
const LATENT_ALIGN = 8;

/** `/history` 的轮询间隔——出图是几十秒级的操作，1 秒一问既不压服务也不明显拖后腿。 */
const POLL_MS = 1000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** API 格式的工作流：节点 id 是键，值是「什么类 + 什么入参」。 */
interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}
type ComfyGraph = Record<string, ComfyNode>;

/** `/history` 里一条记录的完成态与产物。 */
interface ComfyHistoryItem {
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export class ComfyUiImageGen implements ImageBackend {
  private readonly spec: ImageSizeSpec;

  /** fetch 注入点：宿主把代理烘在自己的 fetch 里，测试可替身；`sleep` 同理（轮询间隔可替身）。 */
  constructor(
    private readonly opts: ComfyUiImageOptions,
    private readonly fetchImpl: FetchLike = defaultFetch,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.spec = parseImageSize(opts.size);
  }

  async generate(req: ImageRequest): Promise<GeneratedImage> {
    // 一次出图是三次请求（提交 → 轮询 → 取图），带垫图时前面还多一次上传：
    // 整段的预算在这里定死，谁都不许各自再起一份
    const deadline = Date.now() + this.opts.timeoutMs;
    const references = req.references ?? [];
    if (references.length > 1) {
      throw new Error(
        `ComfyUI 格式一次只垫一张参考图（这次给了 ${references.length} 张）：` +
          "图生图的工作流只挂一个 LoadImage，多张要先自己拼成一张。请只留一张，或把出图格式换成 gemini。",
      );
    }
    const aspectRatio = req.aspectRatio ?? "16:9";
    if (!IMAGE_ASPECTS.includes(aspectRatio)) {
      throw new Error(`画幅（${aspectRatio}）不受支持。可用：${IMAGE_ASPECTS.join(" / ")}`);
    }
    const canvas = this.canvas(req.size, aspectRatio);
    const common = {
      checkpoint: req.model ?? this.opts.model,
      prompt: req.prompt,
      width: canvas.width,
      height: canvas.height,
      seed: Math.floor(Math.random() * 2 ** 32),
    };
    // 垫图先传再拼图：LoadImage 要的是上传后 ComfyUI 侧的真名，上传失败的错比出图超时好查得多
    const graph = references.length
      ? img2imgWorkflow({ ...common, image: await this.uploadImage(references[0]!, deadline) })
      : txt2imgWorkflow(common);
    const promptId = await this.submit(graph, deadline);
    return this.fetchImage(await this.awaitImage(promptId, deadline), deadline);
  }

  /**
   * 上传垫图，拿回 ComfyUI 侧的 `name`（`LoadImage.image` 用的就是它）。
   *
   * 三个要点：
   *
   * - 字段名是 `image`，`content-type`（含 boundary）由 FormData 生成后再序列化成字节发出去
   *   （见 `multipartForm`），既不手写 boundary，也不把「FormData 得是哪个 realm 的类」甩给宿主；
   * - **扩展名按嗅探出的真实字节类型定**，不信入参 `mimeType`（PIL 认内容，但落一张写着 `.jpg` 的 PNG
   *   在运维翻 `input/` 时是纯粹的误导），文件名带时间戳与随机段，不与既有文件撞名；
   * - ComfyUI **没有稳定的删除端点**（删图要走界面侧的 `/api/userdata`，版本间还不一致），所以传上去的
   *   垫图会一直留在 `input/`：**累积是运维清理责任**，本层不承诺回收，也不要指望有朝一日自动删。
   */
  private async uploadImage(ref: { mimeType: string; data: Buffer }, deadline: number): Promise<string> {
    const mimeType = sniffImageMime(ref.data);
    if (!mimeType) {
      throw new Error(
        `ComfyUI 的垫图认不出字节类型（${ref.data.length} 字节，入参写的是 ${ref.mimeType}）：` +
          "只有 PNG / JPEG / WEBP / GIF 能上传。多半是把非图片文件或半截字节当参考图传了进来。",
      );
    }
    // `extOf` 收三种客户端通吃的格式，GIF 得自己认（它是垫图的合法输入，PIL 照收）
    const ext = mimeType === "image/gif" ? ".gif" : extOf(mimeType);
    const filename = `aivn-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const form = await multipartForm(
      { field: "image", filename, mimeType, data: ref.data },
      [["type", "input"]], // LoadImage 只从 input/ 找图（不写时 ComfyUI 也默认 input，写明白）
    );
    const res = await this.fetchImpl(this.url("/upload/image"), {
      method: "POST",
      headers: { ...this.auth(), "content-type": form.contentType },
      body: form.body,
      signal: AbortSignal.timeout(this.budget(deadline)),
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`ComfyUI /upload/image 上传失败 HTTP ${res.status}：${snippet(raw)}`);
    let body: { name?: string } | null = null;
    try {
      body = JSON.parse(raw) as { name?: string };
    } catch {
      body = null;
    }
    const name = body?.name;
    if (!name) throw new Error(`ComfyUI /upload/image 没有回 name：${snippet(raw)}`);
    return name;
  }

  private async submit(graph: ComfyGraph, deadline: number): Promise<string> {
    const res = await this.fetchImpl(this.url("/prompt"), {
      method: "POST",
      headers: { ...this.auth(), "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph }),
      signal: AbortSignal.timeout(this.budget(deadline)),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`ComfyUI /prompt 被拒 HTTP ${res.status}：${nodeErrorsText(body)}`);
    const promptId = (body as { prompt_id?: string } | null)?.prompt_id;
    if (!promptId) {
      throw new Error(`ComfyUI /prompt 没有回 prompt_id：${JSON.stringify(body ?? null).slice(0, 200)}`);
    }
    return promptId;
  }

  /**
   * 等出图：`/history` 在跑完之前要么没有这条记录、要么 `outputs` 是空的，
   * 所以完成判据取「`outputs` 里真有 images」，失败判据取 `status_str === "error"`。
   */
  private async awaitImage(promptId: string, deadline: number): Promise<ComfyImageRef> {
    for (;;) {
      if (Date.now() >= deadline) throw new Error(this.timeoutText(promptId));
      const item = await this.historyOf(promptId, deadline);
      const image = firstImage(item?.outputs);
      if (image) return image;
      if (item?.status?.status_str === "error") {
        throw new Error(`ComfyUI 出图失败：${executionText(item.status.messages)}`);
      }
      // 最后一觉不越过 deadline：多睡的一秒会让「超时」看起来像卡住
      await this.sleep(Math.min(POLL_MS, this.budget(deadline)));
    }
  }

  private async historyOf(promptId: string, deadline: number): Promise<ComfyHistoryItem | null> {
    const res = await this.fetchImpl(this.url(`/history/${encodeURIComponent(promptId)}`), {
      headers: this.auth(),
      signal: AbortSignal.timeout(this.budget(deadline)),
    });
    if (!res.ok) throw new Error(`ComfyUI /history 读取失败 HTTP ${res.status}（prompt ${promptId}）`);
    const body = (await res.json().catch(() => null)) as Record<string, ComfyHistoryItem> | null;
    return body?.[promptId] ?? null;
  }

  private async fetchImage(ref: ComfyImageRef, deadline: number): Promise<GeneratedImage> {
    const query = new URLSearchParams({ filename: ref.filename, type: ref.type ?? "output" });
    if (ref.subfolder) query.set("subfolder", ref.subfolder);
    const res = await this.fetchImpl(this.url(`/view?${query}`), {
      headers: this.auth(),
      signal: AbortSignal.timeout(this.budget(deadline)),
    });
    if (!res.ok) throw new Error(`ComfyUI /view 取图失败 HTTP ${res.status}（${ref.filename}）`);
    const data = Buffer.from(await res.arrayBuffer());
    // 200 不等于「是图」：反代拦下 /view 时会回一页 HTML/JSON。认不出字节就不能交出去——
    // 素材层对认不出尺寸的字节只告警，默认 image/png 会静默落下一张坏素材（背景写 .jpg、立绘写 .png）。
    const mimeType = sniffImageMime(data);
    if (!mimeType) {
      const claimed = res.headers.get("content-type") ?? "没给";
      throw new Error(
        `ComfyUI /view 回来的不是图片（${ref.filename}，${data.length} 字节，响应头写的是 ${claimed}）：` +
          "认不出字节类型。多半是反代把 /view 拦成了错误页，或 /history 给的 filename / subfolder / type 取错了。",
      );
    }
    return { data, mimeType };
  }

  /** 剩余预算（至少 1ms）：0 会让 AbortSignal 当场中断，看起来像网络故障而不是超时。 */
  private budget(deadline: number): number {
    return Math.max(1, deadline - Date.now());
  }

  private timeoutText(promptId: string): string {
    return (
      `ComfyUI 出图超时（${Math.round(this.opts.timeoutMs / 1000)}s）：prompt ${promptId} 还没跑完` +
      "（还在队列里等着，或采样没结束）。调大出图超时，或按类目放宽 `image.kinds.<类目>.timeoutMs`。"
    );
  }

  /** 尺寸：档位按总像素量级换算（两边对齐到 8），字面像素照发但必须是 8 的倍数。 */
  private canvas(rawSize: string | undefined, aspect: ImageAspect): { width: number; height: number } {
    const spec = rawSize ? parseImageSize(rawSize) : this.spec;
    if (spec.kind === "tier") {
      const [width, height] = tierCanvasFor(aspect, spec.tier, LATENT_ALIGN)
        .split("x")
        .map(Number) as [number, number];
      return { width, height };
    }
    if (spec.width % LATENT_ALIGN || spec.height % LATENT_ALIGN) {
      throw new Error(
        `ComfyUI 的 latent 以 ${LATENT_ALIGN} 像素为一格，生图尺寸 ${imageSizeText(spec)} 不是 ${LATENT_ALIGN} 的倍数，` +
          "发出去会被悄悄截断（回图尺寸与要的对不上）。请改成 8 的倍数，或改用档位 1K / 2K / 4K。",
      );
    }
    return { width: spec.width, height: spec.height };
  }

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private auth(): Record<string, string> {
    return this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {};
  }
}

/** 官方默认 txt2img 模板的 API 形态（`filename_prefix` 只影响 ComfyUI 侧的输出文件名）。 */
function txt2imgWorkflow(input: {
  checkpoint: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
}): ComfyGraph {
  return {
    ckpt: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: input.checkpoint } },
    positive: { class_type: "CLIPTextEncode", inputs: { text: input.prompt, clip: ["ckpt", 1] } },
    // 没有负面提示词这个能力位，留空串（模板里本来也是空的）
    negative: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["ckpt", 1] } },
    latent: {
      class_type: "EmptyLatentImage",
      inputs: { width: input.width, height: input.height, batch_size: 1 },
    },
    sampler: {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: 20,
        cfg: 8,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["ckpt", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["ckpt", 2] } },
    save: { class_type: "SaveImage", inputs: { filename_prefix: "aivn", images: ["decode", 0] } },
  };
}

/**
 * 单张垫图的图生图模板：官方默认模板把 EmptyLatentImage 换成
 * `LoadImage → ImageScale → VAEEncode`，采样器仍照原样接。
 *
 * `ImageScale` 一处写死两件事（本层没有对应配置项）：
 *
 * - `crop: "center"`——垫图画幅与目标画布不一致时，先按目标画幅居中裁一刀再重采样，**不拉伸**。
 *   出图构图仍由提示词与画幅决定，垫图只贡献「是谁」。
 * - `upscale_method: "lanczos"`——缩小放大都用它，边缘比 bilinear 干净。
 *
 * `denoise 0.6` 是图生图的核心参数：1.0 等于把垫图当噪声重画（人就不是本人了），太低又改不动
 * 表情与服装。0.6 是这条路的默认值，本层写死。
 */
function img2imgWorkflow(input: {
  checkpoint: string;
  prompt: string;
  width: number;
  height: number;
  seed: number;
  image: string;
}): ComfyGraph {
  return {
    ckpt: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: input.checkpoint } },
    positive: { class_type: "CLIPTextEncode", inputs: { text: input.prompt, clip: ["ckpt", 1] } },
    negative: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["ckpt", 1] } },
    load: { class_type: "LoadImage", inputs: { image: input.image } },
    scale: {
      class_type: "ImageScale",
      inputs: {
        image: ["load", 0],
        upscale_method: "lanczos",
        width: input.width,
        height: input.height,
        crop: "center",
      },
    },
    encode: { class_type: "VAEEncode", inputs: { pixels: ["scale", 0], vae: ["ckpt", 2] } },
    sampler: {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: 20,
        cfg: 8,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 0.6,
        model: ["ckpt", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["encode", 0],
      },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["ckpt", 2] } },
    save: { class_type: "SaveImage", inputs: { filename_prefix: "aivn", images: ["decode", 0] } },
  };
}

/**
 * 组一段 multipart/form-data（一个文件段 + 若干文本段），返回可直接发出去的字节与 `content-type`。
 *
 * boundary 与分段头**都由 FormData 生成**——`new Response(form)` 就是平台把 FormData 序列化成
 * multipart 的那条路，头和实体天然出自同一份，不存在「手写的 boundary 与实体对不上」那种错。
 *
 * 序列化成字节再发，是因为 `FormData` 不是跨实现通用的传输类型：npm `undici` 的 fetch 只认它自己
 * 那套类（`instanceof` 判定），把 Node 全局的 FormData 交给它会以 `text/plain` 发出去一个字面量
 * `"[object FormData]"`（undici 8.11 实测），ComfyUI 那边只会回 400「没收到图片」。字节体谁都认。
 */
async function multipartForm(
  file: { field: string; filename: string; mimeType: string; data: Buffer },
  fields: [name: string, value: string][],
): Promise<{ contentType: string; body: Uint8Array<ArrayBuffer> }> {
  const form = new FormData();
  form.append(file.field, new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.filename);
  for (const [name, value] of fields) form.append(name, value);
  const encoded = new Response(form);
  const contentType = encoded.headers.get("content-type");
  if (!contentType) throw new Error("FormData 序列化后没有 content-type（运行时不对，发出去 ComfyUI 也解析不了）");
  return { contentType, body: new Uint8Array(await encoded.arrayBuffer()) };
}

/** 响应片段：报错里带上原文才有得查，但错误页动辄几 KB，截一段就够。 */
function snippet(text: string): string {
  return text.trim().slice(0, 200) || "（空响应）";
}

/** 产物取第一个带 `images` 的输出节点——模板里只有 SaveImage 会产。 */
function firstImage(outputs: ComfyHistoryItem["outputs"]): ComfyImageRef | null {
  for (const output of Object.values(outputs ?? {})) {
    const image = output?.images?.[0];
    if (image?.filename) return image;
  }
  return null;
}

/**
 * `/prompt` 的 400：`{error: {type, message, details}, node_errors: {"3": {errors: [{message}]}}}`。
 * 节点级的校验失败（checkpoint 名写错、节点类型不存在）只在 `node_errors` 里，不带上就等于什么都没说；
 * 一个节点可能有多条，都带上——只报第一条时，改完第一处还会撞第二处。
 */
function nodeErrorsText(body: unknown): string {
  const error = (body as { error?: { message?: string; details?: string } } | null)?.error;
  const parts = [error?.message, error?.details].filter((text): text is string => Boolean(text));
  const nodeErrors = (body as { node_errors?: Record<string, { errors?: { message?: string }[] }> } | null)?.node_errors;
  for (const [nodeId, info] of Object.entries(nodeErrors ?? {})) {
    const messages = (info?.errors ?? []).map((item) => item?.message).filter((text): text is string => Boolean(text));
    parts.push(messages.length ? `节点 ${nodeId}：${messages.join("；")}` : `节点 ${nodeId}：校验失败`);
  }
  return parts.join("；").slice(0, 300) || "没有错误详情";
}

interface ComfyErrorInfo {
  node_type?: string;
  node_id?: string;
  exception_message?: string;
}

/**
 * 执行期报错：`messages` 是 `[事件名, data]` 的数组，原因在 `execution_error` 那几条的
 * `exception_message` 里。**不能只看最后一条**——它后面还可能有别的事件，那时就只剩「没有错误详情」了。
 */
function executionText(messages: unknown[] | undefined): string {
  const entries = (messages ?? []).map((entry) =>
    Array.isArray(entry)
      ? { event: String(entry[0]), data: entry[1] as ComfyErrorInfo | undefined }
      : { event: "", data: entry as ComfyErrorInfo | undefined },
  );
  const failures = entries.filter((entry) => entry.event === "execution_error");
  const picked = failures.length ? failures : entries.slice(-1);
  const text = picked
    .map((entry) =>
      [[entry.data?.node_type, entry.data?.node_id].filter(Boolean).join(" "), entry.data?.exception_message]
        .filter(Boolean)
        .join("："),
    )
    .filter(Boolean)
    .join("；");
  return text.slice(0, 300) || "没有错误详情";
}
