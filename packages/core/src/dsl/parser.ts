import type { StageEvent } from "./events.js";
import {
  COMMENT_TAG,
  DEFAULT_TITLE_ALIGN,
  DEFAULT_TITLE_MODE,
  DSL_TAGS,
  isActorAnchor,
  isActorShot,
  isTitleAlign,
  isTitleMode,
  LEGACY_TAGS,
  STOP_OPTION_SEPARATOR,
  VOID_TAGS,
  type TitleAlign,
  type TitleMode,
} from "./spec.js";
import {
  DEFAULT_TRANSITION,
  FX_TARGETS,
  effectSpec,
  isFxTarget,
  isTransition,
  type EffectSpec,
  type Transition,
} from "./effects.js";

export type ParserWarningType =
  | "orphan_text"
  | "unknown_tag"
  | "malformed_tag"
  | "mismatched_close"
  | "auto_closed"
  | "nested_wrap"
  | "legacy_tag"
  | "content_after_ending";

export interface ParserWarning {
  type: ParserWarningType;
  detail: string;
}

interface OpenWrap {
  tag: "say" | "narrate" | "thought" | "title" | "epilogue";
  id?: string;
  mood?: string;
  name?: string;
  /** title 专有：对齐与出法。 */
  align?: TitleAlign;
  mode?: TitleMode;
  /** title 专有：正文是否已经开始产出事件（空标题不产出）。 */
  started?: boolean;
  /** title 专有：尚未见非空白字符时先攒着，见 emitText。 */
  pending?: string;
}

/** 结局 id 的口径，与剧目 / 主体 id 一致：字母或数字开头，不含空白与路径分隔符（中文照收）。 */
const ENDING_ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

const MAX_WARNINGS = 200;
const WARN_DETAIL_LIMIT = 120;

const NAME_CHAR_RE = /^[a-z_]/;
const CLOSE_TAG_RE = /^<\/([a-z_]+)\s*>/;
const ATTR_RE = /^\s*([a-z_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/;
/** 无值属性（`<scene bg="x" clear/>` 的 `clear`）：出现即成立，不用写 `="…"`。 */
const BARE_ATTR_RE = /^\s*([a-z_]+)(?=[\s\/]|$)/;

function parseAttrs(source: string): Map<string, string> | null {
  const attrs = new Map<string, string>();
  let rest = source;
  while (rest.trim() !== "") {
    const match = ATTR_RE.exec(rest);
    if (match) {
      const key = match[1]!;
      const value = match[2] ?? match[3] ?? "";
      attrs.set(key, value);
      rest = rest.slice(match[0].length);
      continue;
    }
    const bare = BARE_ATTR_RE.exec(rest);
    if (!bare) return null;
    attrs.set(bare[1]!, "");
    rest = rest.slice(bare[0].length);
  }
  return attrs;
}

/**
 * Stage DSL 流式解析器。
 *
 * - feed() 增量喂入 token 流，chunk 可在任意位置撕裂；
 * - endMessage() 消息边界：未完成标签丢弃，未闭合包裹标签自动闭合（保留已流出台词）；
 * - <comment> 正文整体吞掉、不产出事件（注释是模型的出口，不是演出内容）；
 * - 未知标签按字面文本输出（不丢用户可见内容），残缺标签/属性才丢弃；
 * - 已从 DSL 迁进工具的旧标签（option/preload_asset）**静默丢弃**（见 spec.ts 的 LEGACY_TAGS）。
 */
export class StageDslParser {
  private buffer = "";
  private openWrap: OpenWrap | null = null;
  /** 正在一条 <comment> 里：正文吞掉，且除 </comment> 外的标签都不许开工。 */
  private commentParse = false;
  /**
   * 本条消息里已经交出过结局：其后的任何剧本内容一律丢弃。
   *
   * 终局必须是确定的——模型写完 `<ending/>` 之后多写的那半拍不能被演出来，否则「结局是不是最后
   * 一行」就成了一条靠自觉的软约定。只在**一条消息**内有效，边界即复位。
   */
  private endedInMessage = false;
  readonly warnings: ParserWarning[] = [];

  constructor(private readonly onEvent: (event: StageEvent) => void) {}

  feed(chunk: string): void {
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
        // 像标签的残缺片段（"<say id=…"<）丢弃；不像标签的（"<3"、孤"<"）按字面保留
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
    this.endedInMessage = false;
    if (this.openWrap) this.closeWrap();
  }

  resetBeat(): void {
    this.openWrap = null;
    this.commentParse = false;
    this.endedInMessage = false;
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
      if (!isKnownTag(name)) {
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
    if (!isKnownTag(name)) {
      // 未知标签的闭合与开标签对称：按字面输出
      this.emitText("<");
      this.buffer = this.buffer.slice(1);
      return false;
    }
    this.buffer = this.buffer.slice(match[0].length);
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
    // 结局之后：本条消息里的一切剧本内容都不认（终局是确定的，见 endedInMessage）
    if (this.endedInMessage) {
      this.warn("content_after_ending", `<${name}> 出现在结局之后，丢弃`);
      return;
    }
    // 已迁进工具的旧标签：整条丢弃 + 一条 warning（不按未知标签原样输出，见 isKnownTag）
    if (LEGACY_TAGS.has(name)) {
      this.warn("legacy_tag", `<${name}> 已改为工具调用，丢弃: ${preview(this.rawOf(name, attrs, selfClosing))}`);
      return;
    }
    if (this.commentParse) {
      if (name === COMMENT_TAG) {
        this.warn("malformed_tag", "<comment> 嵌套，忽略内层");
        return;
      }
      // 注释吞到 </comment> 或本条消息结束为止：没有「结构标签强行穿出来」的出口——
      // 模型完全可能在注释里写「下一轮这样写 <say id="角色id">…</say>」，让结构标签自动闭合
      // 反而会把这段示范当场演出来。忘闭合的代价是这一条消息后半段被吞（有护栏兜底），
      // 而自动闭合的代价是把注释内容演给玩家看——后者不可接受。
      this.warn("malformed_tag", `<${name}> 出现在 <comment> 内，丢弃`);
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
        const transition = this.pickTransition(attrs, "scene");
        this.emit({
          kind: "scene",
          ...pick(attrs, ["bg", "bgm", "ambient"]),
          ...(transition ? { transition } : {}),
          // 裸属性（`<scene clear/>`）与显式值（`clear="true"`）都认成开新场；
          // 写了 `clear="false"` / `clear="0"` 才是不清（给模板条件拼串留的出口）。
          ...(isTruthyFlag(attrs.get("clear")) ? { clear: true } : {}),
          ...this.pickVolume(attrs, ["bgm_volume", "ambient_volume"]),
        });
        return;
      }
      case "fx": {
        const target = attrs.get("target")?.trim();
        if (!target || !isFxTarget(target)) {
          return this.dropTag("fx", `target 非法或缺失: ${target ?? ""}（可用 ${FX_TARGETS.join("/")}）`);
        }
        // `release`：停掉该 target 上的全部持续效果，不是效果本身。
        if (isTruthyFlag(attrs.get("release"))) {
          this.emit({ kind: "fx", target, release: true });
          return;
        }
        const effect = attrs.get("effect")?.trim().toLowerCase();
        if (!effect) return this.dropTag("fx", "缺 effect（或写 release 停掉持续效果）");
        const spec = effectSpec(effect);
        if (!spec) return this.dropTag("fx", `未知 effect: ${effect}`);
        if (!spec.targets.includes(target)) return this.dropTag("fx", `effect=${effect} 不适用于 target=${target}`);
        const value = this.pickEffectValue(attrs, spec);
        this.emit({ kind: "fx", target, effect, ...(value !== undefined ? { value } : {}) });
        return;
      }
      case "actor": {
        const id = attrs.get("id");
        if (!id) return this.dropTag("actor", "缺 id");
        const shotRaw = attrs.get("shot");
        const anchorRaw = attrs.get("anchor");
        // `expression` / `state` 是 261004 之前的旧写法（人写表情、非人写状态），
        // 合并成一个槽位后照旧收下：存量剧本不能因为改名就不换图。
        const variant = attrs.get("variant") ?? attrs.get("expression") ?? attrs.get("state");
        this.emit({
          kind: "actor",
          id,
          ...pick(attrs, ["pos", "action", "leave"]),
          ...(variant ? { variant } : {}),
          ...(shotRaw && isActorShot(shotRaw) ? { shot: shotRaw } : {}),
          ...(anchorRaw && isActorAnchor(anchorRaw) ? { anchor: anchorRaw } : {}),
        });
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
      case "cg": {
        const id = attrs.get("id");
        if (!id) return this.dropTag("cg", "缺 id");
        this.emit({ kind: "cg", id, ...pick(attrs, ["caption"]) });
        return;
      }
      case "ending": {
        if (this.openWrap) {
          this.warn("auto_closed", `<ending> 前自动闭合未闭合的 <${this.openWrap.tag}>`);
          this.closeWrap();
        }
        const id = attrs.get("id")?.trim() ?? "";
        if (id === "") return this.dropTag("ending", "缺 id");
        if (!ENDING_ID_RE.test(id)) return this.dropTag("ending", `id 非法: ${id}`);
        const title = attrs.get("title")?.trim();
        const subtitle = attrs.get("subtitle")?.trim();
        // 先置终局标记再发射：其后本条消息的内容一律丢弃。
        this.endedInMessage = true;
        this.emit({
          kind: "ending",
          id,
          ...(title ? { title } : {}),
          ...(subtitle ? { subtitle } : {}),
        });
        return;
      }
      case "stop": {
        const raw = attrs.get("options");
        const placeholder = attrs.get("placeholder")?.trim();
        const options = splitStopOptions(raw);
        if (options.length >= 2) {
          if (placeholder) {
            this.warn("malformed_tag", "options 与 placeholder 同给，按 options 走，placeholder 本轮不生效");
          }
          this.emit({ kind: "stop", stopType: "choice", options: options.map((text) => ({ text })) });
          return;
        }
        if (raw !== undefined) {
          // 一条选项不是「选择」：静默当成自然演完会把模型的一次笔误变成一次没有停止点的轮。
          this.warn("malformed_tag", `options 去掉空白后不足两条，忽略: ${preview(raw)}`);
        }
        if (placeholder) {
          this.emit({ kind: "stop", stopType: "free", placeholder });
          return;
        }
        // 两个都没给（`<stop/>`）：这一段自然演完，不产出停止点——与漏写这个标签同一条路。
        return;
      }
      case "title": {
        if (selfClosing) return this.dropTag(name, "包裹标签不能自闭合");
        if (this.openWrap) {
          this.warn("nested_wrap", `<title> 打开时 <${this.openWrap.tag}> 未闭合，自动闭合前者`);
          this.closeWrap();
        }
        const alignRaw = attrs.get("align");
        const modeRaw = attrs.get("mode");
        const align = isTitleAlign(alignRaw) ? alignRaw : DEFAULT_TITLE_ALIGN;
        const mode = isTitleMode(modeRaw) ? modeRaw : DEFAULT_TITLE_MODE;
        if (alignRaw !== undefined && alignRaw !== align) {
          this.warn("malformed_tag", `title align 非法，取默认 ${align}: ${preview(alignRaw)}`);
        }
        if (modeRaw !== undefined && modeRaw !== mode) {
          this.warn("malformed_tag", `title mode 非法，取默认 ${mode}: ${preview(modeRaw)}`);
        }
        // title_start 延后到第一段非空白正文再发（见 emitText）：空 <title> 不该凭空
        // 制造一个要点掉的全屏空屏。这里只记挂起态。
        this.openWrap = { tag: "title", align, mode, started: false };
        return;
      }
      case "say":
      case "narrate":
      case "thought":
      case "epilogue": {
        if (selfClosing) return this.dropTag(name, "包裹标签不能自闭合");
        const id = attrs.get("id");
        // epilogue 与 narrate 一样不需要 id：它不是某个人说的话，是收束旁白。
        if (name !== "narrate" && name !== "epilogue" && !id) return this.dropTag(name, "缺 id");
        if (this.openWrap) {
          this.warn("nested_wrap", `<${name}> 打开时 <${this.openWrap.tag}> 未闭合，自动闭合前者`);
          this.closeWrap();
        }
        this.openWrap = { tag: name, id, mood: attrs.get("mood"), name: attrs.get("name") };
        if (name === "say") this.emit({ kind: "say_start", id: id!, ...(attrs.get("mood") ? { mood: attrs.get("mood") } : {}), ...(attrs.get("name") ? { name: attrs.get("name") } : {}) });
        else if (name === "narrate") this.emit({ kind: "narrate_start" });
        else if (name === "epilogue") this.emit({ kind: "epilogue_start" });
        else this.emit({ kind: "thought_start", id: id! });
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

  /**
   * 转场属性：认不出来就丢属性、留好属性（同 pickVolume 的策略），并挂 warning。
   * 剧本写错一个转场名，不该把整个换景连背景一起丢掉。
   */
  private pickTransition(attrs: Map<string, string>, tag: string): Transition | undefined {
    const raw = attrs.get("transition");
    if (raw === undefined) return undefined;
    const value = raw.trim().toLowerCase();
    if (isTransition(value)) return value;
    this.warn("malformed_tag", `${tag} 的 transition="${raw}" 认不出来，忽略，按缺省 ${DEFAULT_TRANSITION}`);
    return undefined;
  }

  /** 效果取值：按注册表的封闭枚举归一；越界或多余都退回缺省并挂 warning，不丢整条效果。 */
  private pickEffectValue(attrs: Map<string, string>, spec: EffectSpec): string | undefined {
    if (!spec.values) {
      const raw = attrs.get("value");
      if (raw !== undefined && raw.trim() !== "") {
        this.warn("malformed_tag", `effect=${spec.name} 不接受 value，忽略`);
      }
      return undefined;
    }
    const fallback = spec.defaultValue ?? spec.values[0]!;
    const raw = attrs.get("value")?.trim().toLowerCase();
    if (raw === undefined || raw === "") return fallback;
    if (!spec.values.includes(raw)) {
      this.warn("malformed_tag", `effect=${spec.name} 的 value="${raw}" 非法，改用 ${fallback}`);
      return fallback;
    }
    return raw;
  }

  /** 旧标签原文（供 warning 定位用）：只拼头部，正文一律不留。 */
  private rawOf(name: string, attrs: Map<string, string>, selfClosing: boolean): string {
    const body = [...attrs].map(([k, v]) => ` ${k}="${v}"`).join("");
    return `<${name}${body}${selfClosing ? "/" : ""}>`;
  }

  private emitText(text: string): void {
    if (text === "") return;
    // 注释优先于一切：连 openWrap 也轮不到（comment 不会与包裹标签并存，见 handleTag）
    if (this.commentParse) return;
    // 结局之后：连包裹标签里的正文也一并丢掉（本条消息到此为止）。
    if (this.endedInMessage) return;
    if (this.openWrap) {
      const wrap = this.openWrap;
      if (wrap.tag === "say") this.emit({ kind: "say_text", delta: text });
      else if (wrap.tag === "narrate") this.emit({ kind: "narrate_text", delta: text });
      else if (wrap.tag === "thought") this.emit({ kind: "thought_text", delta: text });
      else if (wrap.tag === "epilogue") this.emit({ kind: "epilogue_text", delta: text });
      else this.emitTitleText(wrap, text);
      return;
    }
    if (text.trim() !== "") this.warn("orphan_text", `标签外裸文本丢弃: ${preview(text)}`);
  }

  /** title 正文：第一段见非空白字符才把挂起的 start 与攒下的空白一起吐出。 */
  private emitTitleText(wrap: OpenWrap, text: string): void {
    if (wrap.started !== true) {
      wrap.pending = (wrap.pending ?? "") + text;
      if (wrap.pending.trim() === "") return;
      wrap.started = true;
      this.emit({ kind: "title_start", align: wrap.align!, mode: wrap.mode! });
      this.emit({ kind: "title_text", delta: wrap.pending });
      wrap.pending = "";
      return;
    }
    this.emit({ kind: "title_text", delta: text });
  }

  private closeWrap(): void {
    const wrap = this.openWrap;
    if (!wrap) return;
    this.openWrap = null;
    if (wrap.tag === "say") this.emit({ kind: "say_end" });
    else if (wrap.tag === "narrate") this.emit({ kind: "narrate_end" });
    else if (wrap.tag === "thought") this.emit({ kind: "thought_end" });
    else if (wrap.tag === "epilogue") this.emit({ kind: "epilogue_end" });
    else if (wrap.started === true) this.emit({ kind: "title_end" });
    else this.warn("malformed_tag", "空 <title> 丢弃（正文为空白）");
  }

  private emit(event: StageEvent): void {
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

/**
 * 已知标签 = 当前 DSL 白名单 + 已迁进工具的旧标签。
 *
 * 旧标签要进白名单**只是为了让它们被整条吞掉**（未知标签的处理是「按字面文本输出」，
 * 那会把 `<option>回家</option>` 念到舞台上）。真正的分派在 handleTag 之前的
 * LEGACY_TAGS 分支：丢弃 + 一条 legacy_tag warning。
 */
function isKnownTag(name: string): boolean {
  return (DSL_TAGS as readonly string[]).includes(name) || LEGACY_TAGS.has(name);
}

/** `<stop options="甲 | 乙"/>` 的载荷：按 `|` 拆、去两端空白、丢空项。 */
function splitStopOptions(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(STOP_OPTION_SEPARATOR)
    .map((text) => text.trim())
    .filter((text) => text !== "");
}

/** 开关型标记：裸写（空串）与 "true"/"1"/"yes" 算开，"false"/"0"/"no" 算关。 */
function isTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "true" || v === "1" || v === "yes") return true;
  return false;
}

function pick(attrs: Map<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = attrs.get(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > WARN_DETAIL_LIMIT ? `${trimmed.slice(0, WARN_DETAIL_LIMIT)}…` : trimmed;
}
