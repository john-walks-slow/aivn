import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { ServerConfig } from "./config.js";

/**
 * Fish Audio TTS 客户端（s2.1-pro-free，免费开发者模型）。
 * - 多 Key 轮询：401/402/429/网络错误换下一把 key 重试（对齐 fish-tts CLI 行为）；
 * - 内容寻址缓存：sha1(voiceId + text) 命中即零请求——分岔/重写重演同一句不烧配额；
 * - 代理：本机代理（api.fish.audio 墙外）。
 */

export interface FishTtsOptions {
  keys: string[];
  baseUrl: string;
  proxy?: string;
  model: string;
  timeoutMs: number;
}

const RETRYABLE_STATUS = new Set([401, 402, 429]);

/** 非轮换错误哨兵：持久性 4xx/5xx 不换 key 重试（换 key 也必然失败，只会烧配额）。 */
class NonRetryableTtsError extends Error {}

export class FishTts {
  private readonly dispatcher: ProxyAgent | undefined;
  private keyCursor = 0;
  /** 同目标文件进行中的请求去重（键为绝对路径：跨剧目同 hash 并发不互等，R-N1）。 */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly opts: FishTtsOptions) {
    if (opts.proxy) this.dispatcher = new ProxyAgent(opts.proxy);
  }

  /**
   * 合成并落盘 media-cache/tts/（hash 命中直接复用；写入临时文件后 rename，防并发交错损坏）。
   * 返回文件名——URL 由调用方拼接（/plays/<id>/media/tts/<file>）。
   */
  async synthesize(text: string, voiceId: string, outDir: string): Promise<{ file: string; cached: boolean }> {
    const file = `${createHash("sha1").update(voiceId).update("\0").update(text).digest("hex")}.mp3`;
    const target = join(outDir, file);
    if (existsSync(target)) return { file, cached: true };
    const running = this.inflight.get(target);
    if (running) {
      await running;
      return { file, cached: true };
    }
    const job = (async (): Promise<void> => {
      const audio = await this.request(text, voiceId);
      await mkdir(outDir, { recursive: true });
      const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, audio);
      await rename(tmp, target);
    })();
    this.inflight.set(target, job);
    try {
      await job;
    } finally {
      this.inflight.delete(target);
    }
    return { file, cached: false };
  }

  private async request(text: string, voiceId: string): Promise<Buffer> {
    const { keys } = this.opts;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < keys.length; attempt += 1) {
      const index = (this.keyCursor + attempt) % keys.length;
      try {
        const res = await undiciFetch(`${this.opts.baseUrl}/v1/tts`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${keys[index]}`,
            "content-type": "application/json",
            model: this.opts.model,
          },
          body: JSON.stringify({
            text,
            reference_id: voiceId,
            format: "mp3",
            latency: "normal",
            prosody: { speed: 1.0, volume: 0.0 },
          }),
          dispatcher: this.dispatcher,
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          if (!RETRYABLE_STATUS.has(res.status)) {
            throw new NonRetryableTtsError(`fish-tts HTTP ${res.status}: ${body.slice(0, 200)}`);
          }
          lastError = new Error(`fish-tts key#${index} HTTP ${res.status}: ${body.slice(0, 200)}`);
          continue;
        }
        // 成功后从下一把 key 起步（真轮询分摊免费额度）
        this.keyCursor = (index + 1) % keys.length;
        return Buffer.from(await res.arrayBuffer());
      } catch (error) {
        // 非轮换错误（持久 4xx/5xx）直接抛出；key 级失败（超时/网络）轮换下一把
        if (error instanceof NonRetryableTtsError) throw error;
        lastError = error;
      }
    }
    throw new Error(`fish-tts 全部 key 失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

/**
 * 从配置装配 TTS 客户端；未启用或无可用 key 返回 null（hello.voice=false，客户端隐藏语音开关）。
 */
export function createTts(config: ServerConfig): FishTts | null {
  if (!config.tts.enabled) return null;
  const valid = config.tts.keys;
  if (valid.length === 0) {
    console.warn("[aivn] STAGE_TTS_KEYS 为空（语音停用）");
    return null;
  }
  return new FishTts({
    keys: valid,
    baseUrl: config.tts.baseUrl,
    proxy: config.tts.proxy || undefined,
    model: "s2.1-pro-free",
    timeoutMs: 20_000,
  });
}
