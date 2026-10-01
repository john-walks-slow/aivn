import type { StageEvent } from "./events.js";
import {
  DSL_TAGS,
  COMMENT_TAG,
  OPTION_TAG,
  STOP_TYPES,
  VOID_TAGS,
  type OptionAttrs,
  type StopType,
} from "./spec.js";

export type ParserWarningType =
  | "orphan_text"
  | "unknown_tag"
  | "malformed_tag"
  | "mismatched_close"
  | "auto_closed"
  | "nested_wrap"
  | "gated";

export interface ParserWarning {
  type: ParserWarningType;
  detail: string;
}

interface OpenWrap {
  tag: "say" | "narrate" | "thought";
  id?: string;
  mood?: string;
  name?: string;
}

interface StopParse {
  stopType: StopType;
  placeholder?: string;
  options: OptionAttrs[];
  option: { value?: string; text: string } | null;
}

const MAX_WARNINGS = 200;
const WARN_DETAIL_LIMIT = 120;

const NAME_CHAR_RE = /^[a-z_]/;
const CLOSE_TAG_RE = /^<\/([a-z_]+)\s*>/;
const ATTR_RE = /^\s*([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/;

function parseAttrs(source: string): Map<string, string> | null {
  const attrs = new Map<string, string>();
  let rest = source;
  while (rest.trim() !== "") {
    const match = ATTR_RE.exec(rest);
    if (!match) return null;
    const key = match[1]!;
    const value = match[2] ?? match[3] ?? "";
    attrs.set(key, value);
    rest = rest.slice(match[0].length);
  }
  return attrs;
}

/**
 * Stage DSL 流式解析器。
 *
 * - feed() 增量喂入 token 流，chunk 可在任意位置撕裂；
 * - endMessage() 消息边界：未完成标签丢弃，未闭合包裹标签自动闭合（保留已流出台词）；
 * - 解析到闭合 <stop> 后本轮闸门开启，其后一切内容静默丢弃，直到 resetBeat()；
 * - <comment> 正文整体吞掉、不产出事件（注释是模型的出口，不是演出内容）；
 * - 未知标签按字面文本输出（不丢用户可见内容），残缺标签/属性才丢弃。
 */
export class StageDslParser {
  private buffer = "";
  private openWrap: OpenWrap | null = null;
  private stopParse: StopParse | null = null;
  /** 正在一条 <comment> 里：正文吞掉，且除 </comment> 外的一切标签都不许开工。 */
  private commentParse = false;
  private stopped = false;
  readonly warnings: ParserWarning[] = [];

  constructor(private readonly onEvent: (event: StageEvent) => void) {}

  get gated(): boolean {
    return this.stopped;
  }

  feed(chunk: string): void {
    if (this.stopped) {
      this.buffer = "";
      return;
    }
    this.buffer += chunk;
    this.run();
  }

  endMessage(): void {
    if (this.buffer !== "") {
      const lt = this.buffer.indexOf("<");
      if (lt === -1) {
        this.emitText(this.buffer);
      } else {
        if (lt > 0) this.emitText(this.buffer.slice(0, lt));
        const rest = this.buffer.slice(lt);
        // 像标签的残缺片段（"<say id=…"</）丢弃；不像标签的（"<3"、孤"<"）按字面保留
        if (/^<\/?[a-z_]/.test(rest)) {
          this.warn("malformed_tag", `消息边界丢弃未完成标签片段: ${preview(rest)}`);
        } else {
          this.emitText(rest);
        }
      }
    }
    this.buffer = "";
    // 注释不跨消息：边界即结束，正文已经吞完，剩下的残句也一并丢掉
    this.commentParse = false;
    if (this.stopParse?.option) this.closeOption();
    if (this.stopParse) this.emitStop();
    if (this.openWrap) this.closeWrap();
  }

  resetBeat(): void {
    this.stopped = false;
    this.openWrap = null;
    this.stopParse = null;
    this.commentParse = false;
    this.buffer = "";
  }

  /**
   * 取走并清空解析告警。
   *
   * 与 resetBeat 分开是刻意的：resetBeat 只复位解析状态，告警是一次性投递的信——
   * 编排器在轮次收束处取走它，回灌给模型自修正；留在原地只会和下一轮的告警混成一堆。
   */
  takeWarnings(): ParserWarning[] {
    return this.warnings.splice(0, this.warnings.length);
  }

  private run(): void {
    for (;;) {
      if (this.stopped) {
        this.buffer = "";
        return;
      }
      const lt = this.buffer.indexOf("<");
      if (lt === -1) {
        this.emitText(this.buffer);
        this.buffer = "";
        return;
      }
      if (lt > 0) {
        this.emitText(this.buffer.slice(0, lt));
        this.buffer = this.buffer.slice(lt);
      }
      if (this.buffer.length < 2) return;
      if (this.buffer[1] === "/") {
        if (this.consumeCloseTag()) return;
        continue;
      }
      if (!NAME_CHAR_RE.test(this.buffer.slice(1))) {
        this.emitText("<");
        this.buffer = this.buffer.slice(1);
        continue;
      }
      // 标签名必须到齐才能判白名单：'<s' 可能是 <scene 的开头，等待名字终结符
      const nameEnd = this.buffer.slice(1).search(/[^a-z_]/);
      if (nameEnd === -1) return;
      const name = this.buffer.slice(1, 1 + nameEnd);
      const known = (DSL_TAGS as readonly string[]).includes(name) || name === OPTION_TAG;
      if (!known) {
        this.emitText("<");
        this.buffer = this.buffer.slice(1);
        continue;
      }
      const gt = this.buffer.indexOf(">");
      if (gt === -1) return;
      this.consumeOpenTag(name, gt);
    }
  }

  /** 消费一个闭合标签。返回 true 表示需要更多数据（等待），false 表示已消费。 */
  private consumeCloseTag(): boolean {
    const match = CLOSE_TAG_RE.exec(this.buffer);
    if (!match) {
      const gt = this.buffer.indexOf(">");
      if (gt === -1) return true;
      this.warn("malformed_tag", `丢弃畸形闭合标签: ${preview(this.buffer.slice(0, gt + 1))}`);
      this.buffer = this.buffer.slice(gt + 1);
      return false;
    }
    const name = match[1]!;
    const known = (DSL_TAGS as readonly string[]).includes(name) || name === OPTION_TAG;
    if (!known) {
      // 未知标签的闭合与开标签对称：按字面输出
      this.emitText("<");
      this.buffer = this.buffer.slice(1);
      return false;
    }
    this.buffer = this.buffer.slice(match[0].length);
    if (name === OPTION_TAG) {
      if (this.stopParse?.option) this.closeOption();
      else this.warn("mismatched_close", "option 闭合出现在 option 之外");
      return false;
    }
    if (this.stopParse && name === "stop") {
      this.emitStop();
      return false;
    }
    if (this.commentParse && name === COMMENT_TAG) {
      this.commentParse = false;
      return false;
    }
    if (this.openWrap && name === this.openWrap.tag) {
      this.closeWrap();
      return false;
    }
    this.warn("mismatched_close", `闭合标签 </${name}> 无对应打开标签，丢弃`);
    return false;
  }

  private consumeOpenTag(name: string, gt: number): void {
    const raw = this.buffer.slice(0, gt + 1);
    this.buffer = this.buffer.slice(gt + 1);
    let inner = raw.slice(1, -1);
    let selfClosing = false;
    if (inner.endsWith("/")) {
      selfClosing = true;
      inner = inner.slice(0, -1);
    }
    inner = inner.slice(name.length);
    const attrs = inner.trim() === "" ? new Map<string, string>() : parseAttrs(inner);
    if (attrs === null) {
      this.warn("malformed_tag", `属性解析失败，丢弃标签: ${preview(raw)}`);
      return;
    }
    this.handleTag(name, attrs, selfClosing);
  }

  private handleTag(name: string, attrs: Map<string, string>, selfClosing: boolean): void {
    if (this.commentParse) {
      if (name === COMMENT_TAG) {
        this.warn("malformed_tag", "<comment> 嵌套，忽略内层");
        return;
      }
      // stop 是结构标签，不能被一条忘了闭合的注释吞掉——先自动闭合注释再继续
      if (name !== "stop") {
        this.warn("malformed_tag", `<${name}> 出现在 <comment> 内，丢弃`);
        return;
      }
      this.warn("auto_closed", "<stop> 前自动闭合未闭合的 <comment>");
      this.commentParse = false;
    }
    if (this.stopParse && name !== OPTION_TAG) {
      this.warn("malformed_tag", `<${name}> 出现在 <stop> 内，丢弃`);
      return;
    }
    if (VOID_TAGS.has(name) && !selfClosing) {
      this.warn("malformed_tag", `<${name}> 为指令标签，应为自闭合（其正文将按裸文本丢弃）`);
    }
    switch (name) {
      case COMMENT_TAG: {
        if (selfClosing) return;
        if (this.openWrap) {
          this.warn("auto_closed", `<comment> 前自动闭合未闭合的 <${this.openWrap.tag}>`);
          this.closeWrap();
        }
        this.commentParse = true;
        return;
      }
      case "scene": {
        this.emit({
          kind: "scene",
          ...pick(attrs, ["bg", "bgm", "ambient", "transition"]),
          ...this.pickVolume(attrs, ["bgm_volume", "ambient_volume"]),
        });
        return;
      }
      case "actor": {
        const id = attrs.get("id");
        if (!id) return this.dropTag("actor", "缺 id");
        this.emit({ kind: "actor", id, ...pick(attrs, ["pos", "expression", "action"]) });
        return;
      }
      case "sfx": {
        const src = attrs.get("src");
        if (!src) return this.dropTag("sfx", "缺 src");
        const volumeAttr = attrs.get("volume");
        const volume = volumeAttr === undefined ? undefined : Number(volumeAttr);
        if (volumeAttr !== undefined && !Number.isFinite(volume)) {
          return this.dropTag("sfx", `volume 非数字: ${volumeAttr}`);
        }
        this.emit({ kind: "sfx", src, volume });
        return;
      }
      case "preload_asset": {
        const type = attrs.get("type");
        const prompt = attrs.get("prompt");
        const rawId = attrs.get("id");
        if (type !== "bg" && type !== "cg" && type !== "sprite") {
          return this.dropTag("preload_asset", `type 非法: ${type ?? "(缺)"}`);
        }
        if (!prompt || !rawId) return this.dropTag("preload_asset", "缺 prompt 或 id");
        // sprite id 缺 variant 时默认 neutral（允许写 <preload_asset type="sprite" id="xiaoyu" .../>）
        const id = type === "sprite" && !rawId.includes(":") ? `${rawId}:neutral` : rawId;
        this.emit({ kind: "preload_asset", type, prompt, id });
        return;
      }
      case "cg": {
        const id = attrs.get("id");
        if (!id) return this.dropTag("cg", "缺 id");
        this.emit({ kind: "cg", id, ...pick(attrs, ["caption"]) });
        return;
      }
      case "say":
      case "narrate":
      case "thought": {
        if (selfClosing) return this.dropTag(name, "包裹标签不能自闭合");
        const id = attrs.get("id");
        if (name !== "narrate" && !id) return this.dropTag(name, "缺 id");
        if (this.openWrap) {
          this.warn("nested_wrap", `<${name}> 打开时 <${this.openWrap.tag}> 未闭合，自动闭合前者`);
          this.closeWrap();
        }
        this.openWrap = { tag: name, id, mood: attrs.get("mood"), name: attrs.get("name") };
        if (name === "say") this.emit({ kind: "say_start", id: id!, ...(attrs.get("mood") ? { mood: attrs.get("mood") } : {}), ...(attrs.get("name") ? { name: attrs.get("name") } : {}) });
        else if (name === "narrate") this.emit({ kind: "narrate_start" });
        else this.emit({ kind: "thought_start", id: id! });
        return;
      }
      case "stop": {
        const type = attrs.get("type");
        if (!isStopType(type)) return this.dropTag("stop", `type 非法: ${type ?? "(缺)"}`);
        if (this.openWrap) {
          this.warn("auto_closed", `<stop> 前自动闭合未闭合的 <${this.openWrap.tag}>`);
          this.closeWrap();
        }
        if (selfClosing) {
          this.stopParse = { stopType: type, placeholder: attrs.get("placeholder"), options: [], option: null };
          this.emitStop();
          return;
        }
        this.stopParse = { stopType: type, placeholder: attrs.get("placeholder"), options: [], option: null };
        return;
      }
      case OPTION_TAG: {
        if (!this.stopParse) {
          this.warn("malformed_tag", "<option> 出现在 <stop> 之外，丢弃");
          return;
        }
        if (this.stopParse.option) {
          this.warn("malformed_tag", "option 嵌套，前一个自动收束");
          this.closeOption();
        }
        if (selfClosing) {
          // 自闭合 option：无正文，立即收束
          this.stopParse.options.push({ text: "", value: attrs.get("value") });
          return;
        }
        this.stopParse.option = { value: attrs.get("value"), text: "" };
        return;
      }
    }
  }

  /**
   * 音量类属性：0–1 的数字。
   *
   * 与 sfx 的差别在这里是刻意的——scene 一个标签带好几样东西，bgm_volume 写错就整条丢弃，
   * 换景会连背景一起丢掉。所以这里只丢坏属性、留好属性，并挂一条 warning 让模型自己改回来。
   */
  private pickVolume(attrs: Map<string, string>, keys: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of keys) {
      const raw = attrs.get(key);
      if (raw === undefined) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        this.warn("malformed_tag", `${key} 非数字，忽略该属性: ${raw}`);
        continue;
      }
      out[key] = Math.min(1, Math.max(0, value));
    }
    return out;
  }

  private emitText(text: string): void {
    if (text === "") return;
    // 注释优先于一切：连 openWrap 也轮不到（comment 不会与包裹标签并存，见 handleTag）
    if (this.commentParse) return;
    if (this.stopParse) {
      if (this.stopParse.option) this.stopParse.option.text += text;
      return;
    }
    if (this.openWrap) {
      const { tag } = this.openWrap;
      if (tag === "say") this.emit({ kind: "say_text", delta: text });
      else if (tag === "narrate") this.emit({ kind: "narrate_text", delta: text });
      else this.emit({ kind: "thought_text", delta: text });
      return;
    }
    if (text.trim() !== "") this.warn("orphan_text", `标签外裸文本丢弃: ${preview(text)}`);
  }

  private closeOption(): void {
    const option = this.stopParse?.option;
    if (!option) return;
    this.stopParse!.options.push({ text: option.text.trim(), value: option.value });
    this.stopParse!.option = null;
  }

  private closeWrap(): void {
    const wrap = this.openWrap;
    if (!wrap) return;
    this.openWrap = null;
    if (wrap.tag === "say") this.emit({ kind: "say_end" });
    else if (wrap.tag === "narrate") this.emit({ kind: "narrate_end" });
    else this.emit({ kind: "thought_end" });
  }

  private emitStop(): void {
    const parse = this.stopParse;
    if (!parse) return;
    if (parse.option) this.closeOption();
    this.stopParse = null;
    if (parse.stopType === "choice" && parse.options.length === 0) {
      this.warn("malformed_tag", "choice stop 无任何选项（护栏应回喂自修正或降级 free）");
    }
    this.emit({
      kind: "stop",
      stopType: parse.stopType,
      options: parse.options.length > 0 ? parse.options : undefined,
      placeholder: parse.placeholder,
    });
    this.stopped = true;
  }

  private emit(event: StageEvent): void {
    if (this.stopped) {
      this.warn("gated", `stop 闸门后事件丢弃: ${event.kind}`);
      return;
    }
    this.onEvent(event);
  }

  private dropTag(name: string, reason: string): void {
    this.warn("malformed_tag", `<${name}> 丢弃: ${reason}`);
  }

  private warn(type: ParserWarningType, detail: string): void {
    if (this.warnings.length >= MAX_WARNINGS) return;
    this.warnings.push({ type, detail });
  }
}

function pick(attrs: Map<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = attrs.get(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function isStopType(value: string | undefined): value is StopType {
  return value !== undefined && (STOP_TYPES as readonly string[]).includes(value);
}

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > WARN_DETAIL_LIMIT ? `${trimmed.slice(0, WARN_DETAIL_LIMIT)}…` : trimmed;
}
