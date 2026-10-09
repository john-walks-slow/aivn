import type { FieldMap } from "../../schema/ir.js";
import type { Capability } from "../capability.js";

/**
 * `music.generate` —— 生成一首 BGM 落进剧目（两个宿主共用）。
 *
 * 两个宿主的**机制**不同（服务端后台排产、发起即返回；插件同步等待、等完才回），
 * 但那不是两种做法，是同一个动作的两种投递方式：参数面、查重、回执口径与提示词怎么写
 * 都该是同一份。机制由 face 通过 `deps.start` 注入（规约 R4：按数据传，不按宿主分支）。
 */

/** 参数真相源：两个宿主的 face 都 pick 这些格（服务端另加长度收紧）。 */
export const musicGenerateFields = {
  name: {
    type: "string",
    required: true,
    description:
      "音乐 id（英文小写、有语义，如 rain_theme / bgm_school_dusk）。剧本里 `<scene bgm=\"rain_theme\">` 引用的就是它；别用 bgm1、test。",
  },
  prompt: {
    type: "string",
    required: true,
    description: "英文出歌提示词：配器 + 情绪走向 + 速度与循环 + 用途（如「quiet piano, rainy afternoon, slow, seamless loop, no fade out」）。",
  },
  overwrite: {
    type: "boolean",
    description:
      "剧目里已有同名曲子时是否重生成（默认 false = 跳过）。默认跳过是防手滑烧配额；**只有用户明确说了要重做这一首时才传 true**。",
  },
  model: { type: "string", description: "换个音乐模型（不给用配置里那个）。" },
} as const satisfies FieldMap;

export const MUSIC_GENERATE_DOC = `生成一首 BGM 并落进 \`assets/bgm/<name>\`，之后剧本里用 \`<scene bgm="name" />\` 引用。

- **要曲子先查库**：库里已有的导进来更快、还免得占生成配额；库里确实没有合适的（缺那个情绪、或用户明确要一首专属的）才生成。
- 提示词写英文，按「配器 + 情绪走向 + 速度与循环 + 用途」四段写；\`seamless loop\` 别省——galgame 的 BGM 要反复铺在对话下面，而实测上游固定给 ~176s，不写循环意图出来的东西往往有明显头尾，接不上。
- 怎么写才出得来日系 galgame 味、哪些词会把它推向别的曲风、mood/scene 该填哪些字，读技能库里的音频那篇（它带着素材库里既有的词表）。
- **元数据不在这个工具上**：出完用 \`annotate_asset\` 标一遍（标题、描述、mood、scene、loop…）——BGM 没有登记那一步，\`annotate_asset\` 是它**唯一**的元数据出口，不标的话剧作家没法按情绪 / 场景选曲。
- **剧目里已有同名曲子会直接跳过**：用户明确说要重做那一首时才带 \`overwrite=true\`，那会覆盖同名那首，动手前先跟用户说清楚。
- 一首 ~176s 的曲子要生成 84 秒上下，比出图慢一档——别为同一类场景反复出。
- 工具只管 BGM。音效（脚步、门响、心跳）没有生成口，库里没有就让用户在素材页上传。`;

/** 归一化后的请求：空串与空数组不留（宿主实现按这个形状发起）。 */
export interface MusicGenerateRequest {
  name: string;
  prompt: string;
  overwrite?: boolean;
  model?: string;
}

/**
 * 生成一首 BGM 要的那两件事。
 *
 * `start` 的返回值就是给模型的那句回执——排产回「已发起，稍后到货」、同步回「已入库」，
 * 机制差异只在这一格，别在共享文案里分叉。
 */
export interface MusicGenerateDeps {
  /** 剧目里已有同名曲子时的 URL，没有则 null。 */
  existing(name: string): Promise<string | null>;
  start(request: MusicGenerateRequest): Promise<string>;
}

export const musicGenerate: Capability<typeof musicGenerateFields, MusicGenerateDeps, string> = {
  id: "music.generate",
  fields: musicGenerateFields,
  doc: MUSIC_GENERATE_DOC,
  async execute(args, deps) {
    const request = requestOf(args);
    try {
      // 已有同名曲子默认就跳过（与生图那条「剧目里已有同名素材就跳过」同一口径）
      const existing = await deps.existing(request.name);
      if (existing && !request.overwrite) return skipReceipt(request.name, existing);
      return await deps.start(request);
    } catch (error) {
      return `没能发起音乐生成：${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/** 把参数收成请求：id 与 prompt 修边，其余空值一律丢掉（下游据此判断「没给」）。 */
export function requestOf(args: {
  name: string;
  prompt: string;
  overwrite?: boolean;
  model?: string;
}): MusicGenerateRequest {
  return {
    name: args.name.trim(),
    prompt: args.prompt.trim(),
    ...(args.overwrite !== undefined ? { overwrite: args.overwrite } : {}),
    ...(args.model?.trim() ? { model: args.model.trim() } : {}),
  };
}

/** 同名曲子已在剧目里：说清改用哪条路径、以及真要重做时带什么。 */
export function skipReceipt(name: string, existing: string): string {
  return (
    `剧目里已经有同名曲子（${existing}），跳过生成。直接 <scene bgm="${name}" /> 引用它；` +
    "用户明确要重做这一首时，带 overwrite=true 覆盖生成。"
  );
}
