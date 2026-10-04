/**
 * 设置面板的传输面：把 `SettingsStore` 里的运行期设置映射成「前端能显示、能提交」的形状。
 *
 * 这一层只做两件事——**凭据掩码**与**提交形态归一**；校验与落盘全在 store 里。
 * 面板只有一个保存入口，任何凭据都不许有绕过它单独落盘的通道。
 */
import { parseModelList, type BootstrapConfig, type ServerConfig, type SettingsPatch } from "./config.js";
import { resolveHost } from "./lanAccess.js";
import { lanAddresses } from "./startup.js";
import type { SettingsStore } from "./settingsStore.js";

/** 多 key 凭据字段（语音 / 联网）的传输面。 */
export interface KeyListView {
  /**
   * 逗号分隔的明文。**读侧恒为空串**——输入框留空即「保持不变」，
   * 填入即整组替换。单独一个写入按钮是设置面板最容易被误操作毁掉凭据的地方。
   */
  keys: string;
  /** 已存 key 的掩码列表（仅供显示「已存 N 把」）。 */
  masked: string[];
  keyCount: number;
}

/** 设置面板的读视图：配置形态 + 凭据存在位（不回传明文）。 */
export interface SettingsView {
  /**
   * 只读的启动参数：进程起来时读一次，改了要重启。
   *
   * 它们留在环境变量里是刻意的——端口与数据目录属于「装在哪、怎么起」，
   * 不属于用户在设置页里反复调的偏好；但界面上要**显示**出来（很多人排查问题时
   * 第一句就是「你到底写在哪个目录」）。
   *
   * `host` 给的是**当前实际**监听的地址（`lanAccess` 已经算进去），
   * `lanUrls` 是手机该连的那几串地址（只听本机时为空）。
   */
  bootstrap: { port: number; host: string; dataRoot: string; lanUrls: string[] };
  model: {
    modelId: string;
    modelBase: string;
    /** 支持清单的文本形态（逗号分隔）：面板上输入什么就显示什么。 */
    models: string;
    baseUrl: string;
    apiKey: string;
    apiKeySet: boolean;
    maxTokens: number;
    contextWindow: number;
    compactRatio: number;
    keepRecentTokens: number;
    /** 限制级（NSFW）专用模型 id；空串 = 沿用 modelId。 */
    nsfwModelId: string;
    /** 限制级（NSFW）专属系统提示词扩展。 */
    nsfwPrompt: string;
  };
  /** 工坊线程压缩参数（工坊模型可与剧作家不同，阈值因此另有一套）。 */
  workshopContext: { contextWindow: number; compactRatio: number; keepRecentTokens: number };
  /** 单轮超时（毫秒）。 */
  beatTimeoutMs: number;
  /** 公网入口密码：留空 = 不设防；掩码回传 = 不改。 */
  password: string;
  passwordSet: boolean;
  /** 允许局域网访问：开着监听 0.0.0.0（显式 --host / STAGE_HOST 优先于它）。 */
  lanAccess: boolean;
  /** 生图（格式 + 连接 + 档位）：key 只回掩码。 */
  image: ServerConfig["image"] & { apiKeySet: boolean };
  /** 音乐生成（BGM）：地址与 key 留空 = 跟生图同一个网关（见 musicConnectionOf）。 */
  music: Omit<ServerConfig["music"], "apiKey"> & { apiKey: string; apiKeySet: boolean };
  tts: Omit<ServerConfig["tts"], "keys"> & KeyListView;
  /** 工坊联网检索（Exa）。 */
  exa: Omit<ServerConfig["exa"], "keys"> & KeyListView;
}

/** 设置面板的写形态：只带被改过的字段，嵌套块各自可部分提交。 */
export interface SettingsViewPatch {
  password?: string;
  lanAccess?: boolean;
  model?: Partial<SettingsView["model"]>;
  workshopContext?: Partial<SettingsView["workshopContext"]>;
  beatTimeoutMs?: number;
  image?: Partial<SettingsView["image"]>;
  music?: Partial<SettingsView["music"]>;
  tts?: Partial<SettingsView["tts"]>;
  exa?: Partial<SettingsView["exa"]>;
}

export class SettingsApi {
  constructor(
    private readonly store: SettingsStore,
    private readonly bootstrap: BootstrapConfig,
  ) {}

  /** 读当前设置：仍然是那一份内存镜像——它此刻就是磁盘上的值（写是即时的）。 */
  read(): SettingsView {
    const config = this.store.get();
    const host = resolveHost(this.bootstrap.host, config.lanAccess);
    return {
      bootstrap: {
        port: this.bootstrap.port,
        host,
        dataRoot: this.bootstrap.dataRoot,
        // 只听本机时给出去也没用，别让用户拿着一个连不上的地址去手机里试
        lanUrls:
          host === "0.0.0.0"
            ? lanAddresses().map((address) => `http://${address}:${this.bootstrap.port}`)
            : [],
      },
      model: {
        modelId: config.modelId,
        modelBase: config.modelBase,
        models: config.models.join(", "),
        baseUrl: config.baseUrl,
        apiKey: mask(config.apiKey),
        apiKeySet: config.apiKey !== "",
        maxTokens: config.maxTokens,
        contextWindow: config.contextWindow,
        compactRatio: config.compactRatio,
        keepRecentTokens: config.keepRecentTokens,
        nsfwModelId: config.nsfwModelId,
        nsfwPrompt: config.nsfwPrompt,
      },
      workshopContext: { ...config.workshopContext },
      beatTimeoutMs: config.beatTimeoutMs,
      password: mask(config.password),
      passwordSet: config.password !== "",
      lanAccess: config.lanAccess,
      image: { ...config.image, apiKey: mask(config.image.apiKey), apiKeySet: config.image.apiKey !== "" },
      music: { ...config.music, apiKey: mask(config.music.apiKey), apiKeySet: config.music.apiKey !== "" },
      tts: { ...withoutKeys(config.tts), ...keyListView(config.tts.keys) },
      exa: { ...withoutKeys(config.exa), ...keyListView(config.exa.keys) },
    };
  }

  /** 提交改动，返回真的变了的字段（面板据此提示「已即时生效」）。 */
  write(patch: SettingsViewPatch): string[] {
    const config = this.store.get();
    const next: SettingsPatch = {};
    const model = patch.model;
    if (model) {
      next.modelId = model.modelId;
      next.modelBase = model.modelBase;
      if (model.models !== undefined) next.models = parseModelList(model.models);
      next.baseUrl = model.baseUrl;
      next.maxTokens = model.maxTokens;
      next.contextWindow = model.contextWindow;
      next.compactRatio = model.compactRatio;
      next.keepRecentTokens = model.keepRecentTokens;
      next.nsfwModelId = model.nsfwModelId;
      next.nsfwPrompt = model.nsfwPrompt;
      // 掩码回传 = 不改；清空输入框 = 显式清除凭据（表单未触碰时会带掩码，不会误清）
      if (model.apiKey !== undefined && model.apiKey !== mask(config.apiKey)) next.apiKey = model.apiKey;
    }
    if (patch.workshopContext) next.workshopContext = { ...patch.workshopContext };
    if (patch.beatTimeoutMs !== undefined) next.beatTimeoutMs = patch.beatTimeoutMs;
    if (patch.password !== undefined && patch.password !== mask(config.password)) next.password = patch.password;
    if (patch.lanAccess !== undefined) next.lanAccess = patch.lanAccess;
    const image = patch.image;
    if (image) {
      next.image = { ...image };
      // 掩码是显示值，不该被当作新密钥写回去
      if (image.apiKey === undefined || image.apiKey === mask(config.image.apiKey)) delete next.image.apiKey;
    }
    const music = patch.music;
    if (music) {
      next.music = { ...music };
      // 掩码是显示值，不该被当作新密钥写回去
      if (music.apiKey === undefined || music.apiKey === mask(config.music.apiKey)) delete next.music.apiKey;
    }
    if (patch.tts) {
      const { keys: keyText, ...rest } = patch.tts;
      const block: NonNullable<SettingsPatch["tts"]> = { ...rest };
      const keys = mergeKeyList(keyText);
      if (keys) block.keys = keys;
      next.tts = block;
    }
    if (patch.exa) {
      const { keys: keyText, ...rest } = patch.exa;
      const block: NonNullable<SettingsPatch["exa"]> = { ...rest };
      const keys = mergeKeyList(keyText);
      if (keys) block.keys = keys;
      next.exa = block;
    }
    return this.store.patch(next);
  }
}

/**
 * 多 key 字段的写侧：留空 = 保持不变，填入 = 整组替换。
 *
 * 「清空」不是可表达的意图——想停用语音/联网有各自的启用开关，
 * 而「不小心清空」是真的发生过（粘贴一把新 key 顺手抹掉另外两把）。
 */
function mergeKeyList(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const keys = parseModelList(raw);
  if (keys.length === 0) throw new Error("没有解析出任何 key");
  return keys;
}

/** 凭据掩码：只露头尾，够用户认是自己那把钥匙。 */
export function mask(secret: string): string {
  if (secret.length <= 8) return secret ? "••••" : "";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function keyListView(keys: string[]): KeyListView {
  return { keys: "", masked: keys.map(mask), keyCount: keys.length };
}

function withoutKeys<T extends { keys: string[] }>(block: T): Omit<T, "keys"> {
  const { keys: _keys, ...rest } = block;
  return rest;
}
