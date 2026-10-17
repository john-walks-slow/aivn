import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { InjectionMessage } from "@aivn/core";

/**
 * 上下文注入的 preset（`<数据目录>/prompt-presets.json`）：Agent 页可以把当前那一组
 * 注入消息存成有名字的一份，之后换个剧目也能加载回来。
 *
 * **preset 是应用级的**，不跟剧目走——它的用处就是跨剧目复用同一套开场铺垫；
 * 落在 play.json 里就只能跟着那一个剧目生灭。当前启用的是哪一份则仍是逐剧目的事
 * （play.json 的 `agents.injection`）。
 *
 * 一份 JSON、整表读改写：preset 是用户手点出来的小数据，不需要第二个真相源。
 */
export interface PromptPreset {
  name: string;
  messages: InjectionMessage[];
  updatedAt: number;
}

/** 名字与内容的边界：界面输入框之外没有第二道闸，越界的东西不该进文件。 */
export const PRESET_NAME_MAX = 60;
const MAX_MESSAGES = 50;
const MAX_TEXT_CHARS = 20_000;

interface PresetFile {
  presets?: PromptPreset[];
}

export class PromptPresets {
  /** 写串行化：读-改-写整表，两次并发保存会互相覆盖（单用户也不该靠手速保证）。 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<PromptPreset[]> {
    return this.read();
  }

  /** 按名字 upsert（同名覆盖），返回整表。 */
  async save(name: string, messages: readonly InjectionMessage[]): Promise<PromptPreset[]> {
    const clean = assertName(name);
    const body = cleanMessages(messages);
    if (body.length === 0) throw new Error("这一组注入消息是空的，没有可保存的内容");
    return this.mutate((presets) => {
      const entry: PromptPreset = { name: clean, messages: body, updatedAt: Date.now() };
      // 同名就地替换：preset 在列表里的位置属于用户（下拉里换来换去会让人抓不住哪份是哪份）
      const at = presets.findIndex((preset) => preset.name === clean);
      if (at < 0) return [...presets, entry];
      const next = [...presets];
      next[at] = entry;
      return next;
    });
  }

  async remove(name: string): Promise<PromptPreset[]> {
    const clean = assertName(name);
    return this.mutate((presets) => presets.filter((preset) => preset.name !== clean));
  }

  private mutate(fn: (presets: PromptPreset[]) => PromptPreset[]): Promise<PromptPreset[]> {
    const run = this.queue.then(async () => {
      const next = fn(await this.read());
      await this.write(next);
      return next;
    });
    // 队列本身不因某一次失败而断掉：失败的调用自己拿到 reject，后面的照常跑
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<PromptPreset[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch {
      // 还没存过任何 preset 是常态，不是错误
      return [];
    }
    const data = JSON.parse(raw) as PresetFile;
    return (Array.isArray(data?.presets) ? data.presets : []).map((preset) => ({
      name: String(preset?.name ?? ""),
      messages: cleanMessages(preset?.messages ?? []),
      updatedAt: Number(preset?.updatedAt) || 0,
    }));
  }

  private async write(presets: readonly PromptPreset[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    // 临时名带随机后缀：并发落盘不共用同一个 tmp（共用会互相覆盖出坏 JSON）
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ presets }, null, 2));
    await rename(tmp, this.file);
  }
}

function assertName(name: string): string {
  const clean = (name ?? "").trim();
  if (clean === "") throw new Error("preset 需要一个名字");
  if (clean.length > PRESET_NAME_MAX) throw new Error(`preset 名字不能超过 ${PRESET_NAME_MAX} 个字`);
  return clean;
}

/** 只收认得出的角色与非空正文，其余丢掉——与 core 的归一化同一套口径。 */
function cleanMessages(messages: readonly InjectionMessage[]): InjectionMessage[] {
  const out: InjectionMessage[] = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message?.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") continue;
    const text = typeof message.text === "string" ? message.text.trim() : "";
    if (text === "" || text.length > MAX_TEXT_CHARS) continue;
    out.push({ role, text });
    if (out.length >= MAX_MESSAGES) break;
  }
  return out;
}
