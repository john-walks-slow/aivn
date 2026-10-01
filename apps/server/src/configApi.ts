/**
 * 设置面板后端（P6）：把 `.env` 当作可写配置面——用户不该被迫手动改配置文件。
 *
 * 读写都按「解析成有序键值对 → 只改被改的键 → 逐行重写」执行，保留注释与未涉及的键。
 * 敏感值（API Key / TTS keys）只回掩码，前端原样回传掩码即视为「不改」。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readKeysFile, type ServerConfig } from "./config.js";

/** 设置面板的传输面：配置形态 + 凭据存在位（不回传明文）。 */
export interface SettingsView {
  port: number;
  playsRoot: string;
  model: {
    modelId: string;
    modelBase: string;
    baseUrl: string;
    apiKey: string;
    apiKeySet: boolean;
    maxTokens: number;
    contextWindow: number;
    compactRatio: number;
    keepRecentTokens: number;
  };
  image: ServerConfig["image"];
  /** flow2api 生图后端（backend=flow2api 时才生效）：key 只回掩码。 */
  flow: ServerConfig["flow"] & { apiKeySet: boolean };
  tts: ServerConfig["tts"] & { keyCount: number };
}

export class SettingsFile {
  constructor(
    private readonly envPath: string,
    private readonly config: ServerConfig,
  ) {}

  /**
   * 读当前配置面：**以 `.env` 磁盘值为准**，缺失的键回落启动时的配置（默认值）。
   *
   * 磁盘优先是刻意的：面板的语义是「改完重启生效」，那它就该显示「重启后会被读到的值」，
   * 否则保存后立刻回读会把刚写的值又显示成旧值（看起来像没保存成功）。
   */
  read(): SettingsView {
    const env = readEnv(this.envPath);
    const text = (key: string, fallback: string): string => env.get(key) ?? fallback;
    const num = (key: string, fallback: number): number => {
      const parsed = Number(env.get(key));
      return env.get(key) !== undefined && Number.isFinite(parsed) ? parsed : fallback;
    };
    const bool = (key: string, fallback: boolean): boolean => {
      const raw = env.get(key);
      if (raw === undefined) return fallback;
      return raw !== "false" && raw !== "0";
    };
    const apiKey = text("STAGE_API_KEY", this.config.apiKey);
    const flowKey = text("STAGE_FLOW_API_KEY", this.config.flow.apiKey);
    const keysPath = text("STAGE_TTS_KEYS", this.config.tts.keysPath);
    return {
      port: num("STAGE_PORT", this.config.port),
      playsRoot: text("STAGE_PLAYS_ROOT", this.config.playsRoot),
      model: {
        modelId: text("STAGE_MODEL_ID", this.config.modelId),
        modelBase: text("STAGE_MODEL_BASE", this.config.modelBase),
        baseUrl: text("STAGE_BASE_URL", this.config.baseUrl),
        apiKey: mask(apiKey),
        apiKeySet: apiKey.length > 0,
        maxTokens: num("STAGE_MAX_TOKENS", this.config.maxTokens),
        contextWindow: num("STAGE_CONTEXT_WINDOW", this.config.contextWindow),
        compactRatio: num("STAGE_COMPACT_RATIO", this.config.compactRatio),
        keepRecentTokens: num("STAGE_KEEP_RECENT_TOKENS", this.config.keepRecentTokens),
      },
      image: {
        enabled: bool("STAGE_IMAGE_ENABLED", this.config.image.enabled),
        backend: text("STAGE_IMAGE_BACKEND", this.config.image.backend) as ServerConfig["image"]["backend"],
        model: text("STAGE_IMAGE_MODEL", this.config.image.model),
        size: text("STAGE_IMAGE_SIZE", this.config.image.size),
        concurrency: num("STAGE_IMAGE_CONCURRENCY", this.config.image.concurrency),
        timeoutMs: num("STAGE_IMAGE_TIMEOUT_MS", this.config.image.timeoutMs),
        reference: text("STAGE_IMAGE_REFERENCE", this.config.image.reference) as ServerConfig["image"]["reference"],
      },
      flow: {
        baseUrl: text("STAGE_FLOW_BASE_URL", this.config.flow.baseUrl),
        apiKey: mask(flowKey),
        apiKeySet: flowKey.length > 0,
        model: text("STAGE_FLOW_MODEL", this.config.flow.model),
        size: text("STAGE_FLOW_SIZE", this.config.flow.size) as ServerConfig["flow"]["size"],
        timeoutMs: num("STAGE_FLOW_TIMEOUT_MS", this.config.flow.timeoutMs),
      },
      tts: {
        enabled: bool("STAGE_TTS_ENABLED", this.config.tts.enabled),
        keysPath,
        proxy: text("STAGE_TTS_PROXY", this.config.tts.proxy),
        baseUrl: text("STAGE_TTS_BASE_URL", this.config.tts.baseUrl),
        concurrency: num("STAGE_TTS_CONCURRENCY", this.config.tts.concurrency),
        keyCount: readKeysFile(keysPath).length,
      },
    };
  }

  /** 写回 `.env`：只落改动过的键，掩码/空的凭据视为「保持不变」。 */
  write(patch: Partial<SettingsView>): string[] {
    const changed: string[] = [];
    const model = patch.model;
    if (model) {
      if (model.modelId !== undefined) set(this.envPath, "STAGE_MODEL_ID", model.modelId, changed);
      if (model.modelBase !== undefined) set(this.envPath, "STAGE_MODEL_BASE", model.modelBase, changed);
      if (model.baseUrl !== undefined) set(this.envPath, "STAGE_BASE_URL", model.baseUrl, changed);
      if (model.maxTokens !== undefined) {
        set(this.envPath, "STAGE_MAX_TOKENS", String(int(model.maxTokens, "输出上限")), changed);
      }
      if (model.contextWindow !== undefined) {
        set(this.envPath, "STAGE_CONTEXT_WINDOW", String(int(model.contextWindow, "上下文窗口")), changed);
      }
      if (model.compactRatio !== undefined) {
        set(this.envPath, "STAGE_COMPACT_RATIO", String(ratio(model.compactRatio)), changed);
      }
      if (model.keepRecentTokens !== undefined) {
        set(
          this.envPath,
          "STAGE_KEEP_RECENT_TOKENS",
          String(int(model.keepRecentTokens, "保留上下文")),
          changed,
        );
      }
      // 掩码回传 = 不改；清空输入框 = 显式清除凭据（表单未触碰时会带掩码，不会误清）
      if (model.apiKey !== undefined && model.apiKey !== mask(this.read().model.apiKey)) {
        set(this.envPath, "STAGE_API_KEY", model.apiKey, changed);
      }
    }
    const image = patch.image;
    if (image) {
      if (image.enabled !== undefined) {
        set(this.envPath, "STAGE_IMAGE_ENABLED", String(image.enabled), changed);
      }
      if (image.backend !== undefined) {
        set(this.envPath, "STAGE_IMAGE_BACKEND", image.backend, changed);
      }
      if (image.model !== undefined) set(this.envPath, "STAGE_IMAGE_MODEL", image.model, changed);
      if (image.size !== undefined) set(this.envPath, "STAGE_IMAGE_SIZE", image.size, changed);
      if (image.concurrency !== undefined) {
        set(this.envPath, "STAGE_IMAGE_CONCURRENCY", String(int(image.concurrency, "出图并发")), changed);
      }
      if (image.timeoutMs !== undefined) {
        set(
          this.envPath,
          "STAGE_IMAGE_TIMEOUT_MS",
          String(int(image.timeoutMs, "出图超时")),
          changed,
        );
      }
    }
    const flow = patch.flow;
    if (flow) {
      if (flow.baseUrl !== undefined) set(this.envPath, "STAGE_FLOW_BASE_URL", flow.baseUrl, changed);
      if (flow.model !== undefined) set(this.envPath, "STAGE_FLOW_MODEL", flow.model, changed);
      if (flow.size !== undefined) set(this.envPath, "STAGE_FLOW_SIZE", flow.size, changed);
      if (flow.timeoutMs !== undefined) {
        set(this.envPath, "STAGE_FLOW_TIMEOUT_MS", String(int(flow.timeoutMs, "flow2api 出图超时")), changed);
      }
      if (flow.apiKey !== undefined && flow.apiKey !== mask(this.read().flow.apiKey)) {
        set(this.envPath, "STAGE_FLOW_API_KEY", flow.apiKey, changed);
      }
    }
    const tts = patch.tts;
    if (tts) {
      if (tts.enabled !== undefined) set(this.envPath, "STAGE_TTS_ENABLED", String(tts.enabled), changed);
      if (tts.keysPath !== undefined) set(this.envPath, "STAGE_TTS_KEYS", tts.keysPath, changed);
      if (tts.proxy !== undefined) set(this.envPath, "STAGE_TTS_PROXY", tts.proxy, changed);
      if (tts.baseUrl !== undefined) set(this.envPath, "STAGE_TTS_BASE_URL", tts.baseUrl, changed);
      if (tts.concurrency !== undefined) {
        set(this.envPath, "STAGE_TTS_CONCURRENCY", String(int(tts.concurrency, "语音并发")), changed);
      }
    }
    return changed;
  }

  /** TTS keys 文件的明文键（仅供 PUT 整体覆盖；GET 侧只回条数与掩码）。 */
  readTtsKeys(): string[] {
    return readKeysFile(this.read().tts.keysPath);
  }

  writeTtsKeys(keys: string[]): void {
    writeFileSync(this.read().tts.keysPath, JSON.stringify(keys, null, 2), "utf8");
  }
}

export function settingsFileFor(config: ServerConfig, repoRoot: string): SettingsFile {
  return new SettingsFile(join(repoRoot, ".env"), config);
}

/** 凭据掩码：只露头尾，够用户认是自己那把钥匙。 */
export function mask(secret: string): string {
  if (secret.length <= 8) return secret ? "••••" : "";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function int(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label}必须是正整数`);
  return value;
}

function ratio(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw new Error("压缩阈值必须是 0 到 1 之间的小数");
  return value;
}

/** 单键落盘：原文件里有就替换那一行，没有就追加到末尾（文件始终以换行收尾）。 */
function set(path: string, key: string, raw: string, changed: string[]): void {
  const value = raw.replace(/[\r\n]/g, "");
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.trimStart().startsWith(prefix));
  if (index >= 0) {
    if (lines[index]!.trim() === `${prefix}${value}`) return;
    lines[index] = `${prefix}${value}`;
  } else {
    while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
    lines.push(`${prefix}${value}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  changed.push(key);
}

/** 解析 `.env`（`KEY=VALUE`，忽略注释与空行；只认本面板关心的 STAGE_ 键）。 */
function readEnv(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("STAGE_") || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, ""));
  }
  return out;
}
