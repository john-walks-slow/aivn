import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  actionAnimation,
  resolveSceneBg,
  spriteStagePreset,
  transitionVeilColor,
  type ActorAction,
  type ActorAnchor,
  type ActorShot,
  type SpriteFraming,
  type SpriteStature,
} from "@aivn/core";
import { dialogContent, emptyDialogHint, titleStepEnds } from "./playbackState.js";
import { actorName } from "./script.js";
import { speakerFocusId, type Playback, type VisualState } from "./director.js";
import type { AssetIndex } from "./assets.js";
import { LoopChannel, SfxPlayer } from "./loopAudio.js";
import type { TranscriptEntry } from "./transcript.js";
import { Icon } from "./ui/Icon.js";
import { escapeClaimed } from "./ui/escape.js";
import { Modal } from "./ui/Modal.js";
import type { StageView } from "./view.js";

interface StageTheaterProps {
  visual: VisualState;
  playback: Playback;
  live: boolean;
  /** 空树：还没开演过，台词区提示改说「按开演」。 */
  fresh?: boolean;
  names: Readonly<Record<string, string>>;
  index: AssetIndex;
  /** 服务端 TTS 能力（false 时隐藏语音相关的一切）。 */
  voiceAvailable: boolean;
  /** 语音总开关（对话框右下角的「语音」）：关 = 停合成，也省配额。 */
  voiceOn: boolean;
  onToggleVoice: () => void;
  /** 结构性操作会腰斩正在演的这一轮，busy 时 ✎/↺ 置灰（插一句仍可用，它排进待注入队列）。 */
  busy: boolean;
  /** 由当前显示行 seq 反查出的锚点：编辑绑行，重写绑整轮。 */
  targets: DirectorTargets;
  /**
   * 「提示」：唯一的输入通道。
   * `guide` = 排进待注入队列、随下一轮一起发；`interrupt` = 先停下这一轮再用它接着写
   * （第二岔由 `promptAlt` 决定给不给）。
   */
  onPrompt: (text: string, mode: "guide" | "interrupt") => void;
  onEdit: (nodeId: string, text: string) => void;
  /** 分岔锚点：字符串是谱系节点 id（回顾/路线），数字是舞台当前行的 seq。
   *  `replaced` = 被这次重写顶掉的那一拍的首节点（新 fork 标记按它算来源标签）；
   *  `instruction` = 随这一岔交代的一句，它是新枝这一轮的第一条输入。 */
  onFork: (
    anchor: string | number,
    opts?: { resume?: boolean; replaced?: string; instruction?: string },
  ) => void;
  /** 导演生图：按当前这一幕出一张插图，指令可留空。
   *  回看中带上正在看的那一行（anchorNodeId）：提示词与落点都按那一刻走；
   *  这一行还没进谱系就传 null（服务端明确拒绝，不悄悄改成末尾生图）。 */
  onGenerateCg: (
    instruction: string,
    opts?: { referenceCharacters?: string[]; useHistory?: boolean; anchorNodeId?: string | null },
  ) => void;
  onReplay: (seq: number) => void;
  /** 这一行的语音处于哪一态：none=没配音色/不生成，pending=正在合成，ready=可重听。 */
  voiceState: (seq: number | null) => VoiceState;
  onUnlock: () => void;
  onView: (view: StageView) => void;
  /** 点舞台即开新轮：等到内容演完且存在 pause 停止点时成立（不再单列「继续」按钮）。 */
  canContinue: boolean;
  onContinue: () => void;
  /**
   * 已到达结局（终局态）：点舞台不再推进任何东西。这一位只负责把舞台自身残留的「继续」入口
   * 关死——终幕画面由剧作家自己写进剧本，引擎不摆任何结局卡。缺省 false（无结局概念的老宿主照旧）。
   */
  ended?: boolean;
  /** 快进档：按住 Ctrl 期间为 true，松开/失焦回 false。 */
  onTurbo: (on: boolean) => void;
  /**
   * 「提示」面板的第二岔由宿主决定：`fork` = 从这一行开新分支（AIVN 主线，有谱系时的做法），
   * `interrupt` = 打断这一轮、用这句接着写（宿主没有谱系时的做法）。缺省 `fork`。
   */
  promptAlt?: "fork" | "interrupt";
  /** 出图这一格归不归宿主：宿主没有生图落点时关掉，别摆一个点了没反应的键。缺省开。 */
  showGenerate?: boolean;
  /**
   * 停止点浮层（选肢卡、自由输入、no_stop 时的「（继续）」卡）。
   * 它挂在**画面区**里：只盖住背景与立绘，台词条、工具栏、侧栏都照常可点——
   * 选肢时要紧的只有「别手滑把这一轮点了过去」。
   */
  overlay?: ReactNode;
  /**
   * 右上角导演工具栏（提示/改写/重写/生图/重听）。默认开。
   * 没有落点的宿主（手里只有 IR 事件流、没有谱系与服务端动作）把它关掉：
   * 那一块不渲染，`.theater` 的 `--dir-h` 也随之写回 0，画面上不留一条空缝。
   */
  directorBar?: boolean;
}

export interface DirectorTargets {
  /** 重写这一轮的锚点（`BeatCard.forkFromId`）：本轮之前的那一点，第一轮就是轮首。 */
  beatId: string | null;
  /** 被重写顶掉的那一拍的首节点：新 fork 标记按它算来源标签、它带的那句输入也跟着新枝走。 */
  beatNodeId: string | null;
  lineNodeId: string | null;
  /** 正在显示的这一行在事件缓冲里的 seq：分岔的落点就靠它（轮内谱系还没追上，id 靠不住）。 */
  lineSeq: number | null;
  lineText: string;
}

/** 一行的语音状态。pending=已发去合成、音频还没到；图标在这两态之间切换。 */
export type VoiceState = "none" | "pending" | "ready";

/**
 * 导演栏的动作。分岔从「当前这一行」开（舞台传 seq），重新生成从整轮开头重写（传 beatId）；
 * 生图不进分支、直接落图。
 */
import { RefCharacterPicker, type RefCandidate } from "./ui/RefCharacterPicker.js";
import { cgCanSubmit, toggleReference } from "./cgOptions.js";

type DirectorAction = "prompt" | "edit" | "restart" | "fork" | "cg" | "interrupt";

/**
 * 「提示」面板里的两岔：跟着这一轮写下去（引导），还是走另一条路——
 * 有谱系的宿主是「从这一行开新分支」（分岔），没有谱系的宿主是「停下这一轮、用这句接着写」（打断）。
 */
type GuideMode = "guide" | "fork" | "interrupt";

const ACTION_META: Record<
  DirectorAction,
  { title: string; hint: string; placeholder: string; submit: (draft: string) => string }
> = {
  prompt: {
    title: "提示",
    hint: "",
    placeholder: "写一句…",
    submit: () => "发送",
  },
  interrupt: {
    title: "打断",
    hint: "立刻停下这一轮，用这句接着写。",
    placeholder: "接下来怎么写…",
    submit: () => "打断并发送",
  },
  edit: {
    title: "改写这句",
    hint: "只改这一句，剧情照旧往下走。",
    placeholder: "改写这句…",
    submit: () => "改写",
  },
  restart: {
    title: "重新生成",
    hint: "从这一轮开头重写：原有内容整段留作旧枝，可以交代一句要求（留空就是纯重写）。",
    placeholder: "想换什么方向？（可留空）",
    submit: (d) => (d ? "重新生成 · 带着这句" : "重新生成"),
  },
  fork: {
    title: "分岔",
    hint: "从这一行开新分支。",
    placeholder: "新分支的第一句（可留空）",
    submit: (d) => (d ? "分岔 · 带着这句" : "分岔"),
  },
  cg: {
    title: "生成插图",
    hint: "留空 = 按刚才这一幕构图。",
    placeholder: "想画成什么样？（可留空）",
    submit: () => "生成",
  },
};

/** 「提示」面板两岔各自的一句话说明：说清这一句发出去会发生什么。 */
const GUIDE_HINT: Record<GuideMode, string> = {
  guide: "排进队列，随下一轮一起发送。",
  fork: "从正在看的这一行开新分支。",
  interrupt: "立刻停下这一轮，用这句接着写。",
};
/**
 * 「提示」面板这一下按的是哪条岔。引导仍是 prompt 本身（宿主那边差别只有「排进队列」）；
 * 另一岔直接借用它的动作名（`fork` / `interrupt`），提交处按名字分派。
 */
function effectiveAction(action: DirectorAction | null, guideMode: GuideMode): DirectorAction {
  if (action !== "prompt") return action ?? "prompt";
  return guideMode === "guide" ? "prompt" : guideMode;
}

/** 输入态：输入框里的按键是文字的，不能被舞台的快捷键与快进档抢走。 */
function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** 插一句的快捷前缀：以它开头 = 明确指示，剧作家遵从但不跳出戏外回应。正文里也要认得这个。 */
const OOC_PREFIX = "OOC：";

/**
 * 运镜缩放：把立绘推近/拉远。
 *
 * 作用于**已有素材**、不重新生图——「给她一个特写」在舞台上就是把她的图放大。
 * 放大锚在头顶（CSS 的 transform-origin: top center），所以推近时头不动、身体往
 * 画面下沿长出去被裁掉，正是「镜头推近」的观感。数值是拍脑袋定的视觉档，不是可调参数。
 */
const SHOT_SCALE: Record<ActorShot, number> = {
  wide: 0.86,
  normal: 1,
  close: 1.35,
  extreme: 1.85,
};

/**
 * 立绘：表情差分之间交叉淡入。
 * 新图先在内存里解码好再叠上去，切换只是一层 opacity 过渡——不会出现白闪或半张脸。
 *
 * 加载失败（剧目里配的立绘文件已被删/改名）就地退场，不留浏览器那张裂图：
 * 没有立绘的舞台本来就该是空的，一张裂图反而像是引擎坏了。
 */
function Sprite({
  url,
  pos,
  name,
  framing,
  stature,
  shot,
  anchor,
  leaving,
  action,
  actionSeq,
  zIndex,
  dim,
}: {
  url: string | null;
  pos: string;
  name: string;
  framing: SpriteFraming;
  stature: SpriteStature;
  shot: ActorShot | null;
  anchor: ActorAnchor;
  leaving: boolean;
  /** 行为词（剧本的 `action=`）：一次性演出，配方在 app.css 的 @keyframes。 */
  action: ActorAction | null;
  /** 同一行为词要能连演（nod 之后又 nod），靠这个序号让 animation 重挂一次。 */
  actionSeq: number;
  /** 层级：后上场的更高，说话中的角色最高（见下面的 orderSeq 与 speakerFocusId）。 */
  zIndex: number;
  /** 非当前说话人：压暗到 --sprite-dim，把注意力留给说话的那个。 */
  dim: boolean;
}): ReactNode {
  const [current, setCurrent] = useState<string | null>(url);
  const [outgoing, setOutgoing] = useState<string | null>(null);

  useEffect(() => {
    if (!url || url === current) return;
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    img.onload = () => {
      setOutgoing(current);
      setCurrent(url);
      timer = setTimeout(() => setOutgoing(null), 260);
    };
    img.src = url;
    return () => {
      img.onload = null;
      if (timer) clearTimeout(timer);
    };
  }, [url, current]);

  // 行为词是一次性演出：播完就把 .acting 摘掉，否则它会一直占着 --scale。
  // 连演同一个词要能重播——同一个 animation 值连写两次不会重来，所以用一个
  // 递增的 nonce 不去改 animation 名（改了就找不到 @keyframes），而是作为第二个
  // 参数传给 animation：同名动画的 animation-name 与前一次不同，浏览器就认成
  // 新动画从 0% 播起——这是重播同一段 CSS 动画的标准手法。
  const [acting, setActing] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!action) {
      setActing(false);
      return;
    }
    setActing(true);
    setNonce((n) => n + 1);
    const timer = setTimeout(() => setActing(false), 560);
    return () => clearTimeout(timer);
  }, [action, actionSeq]);

  if (!current) return null;
  // 站位类直接用 pos-*（CSS 里各自带 --x 偏移，见 app.css）。
  // 落位与运镜走行内 CSS 变量——它们是这一句台词 + 这一份素材声明的结果，
  // 不该在 CSS 里枚举成类名（三档取景 × 四档体量 × 三档对齐 = 36 个类，加一档就全要改）。
  // .entering 常驻即可，不用挂一帧就摘：CSS 动画不会因重渲染重播，而 key 是角色
  // id，组件只在这个人第一次进舞台时挂载（换表情走的是另一条淡出/淡入，不重挂载）。
  // 所以「重新进场」天然就是一次新挂载，入场动画也就重播一次。
  // 正在退场的那一瞬不挂：离场走 .leaving 的淡出，混上入场动画会打架。
  const cls = `theater-sprite pos-${pos}${leaving ? " leaving" : " entering"}${
    acting ? " acting" : ""
  }${dim ? " dim" : ""}`;
  // 横竖屏两列都由 core 的表算好，媒体查询在 CSS 里挑一列——组件不必监听 resize
  const stage = spriteStagePreset(framing, stature, anchor);
  const style: CSSProperties = {
    zIndex,
    "--scale": SHOT_SCALE[shot ?? "normal"],
    "--sprite-top": `${stage.landscape.top}%`,
    "--sprite-height": `${stage.landscape.height}%`,
    "--sprite-origin": stage.landscape.origin,
    "--sprite-top-portrait": `${stage.portrait.top}%`,
    "--sprite-height-portrait": `${stage.portrait.height}%`,
    "--sprite-origin-portrait": stage.portrait.origin,
    "--sprite-act": actionAnimation(action) ?? "none",
    // 时间不是数字：delay 与 iteration-count 相邻时，两个裸数字会让浏览器
    // 判不出哪个是哪个、整条 animation 丢弃（见 app.css .acting 的注释）。
    "--act-nonce": `-${(nonce % 100) / 1000}s`,
  } as CSSProperties;
  // 加载失败就地退场（详见上方注释）：裂图比空舞台更像坏了。
  const onError = (): void => {
    setOutgoing(null);
    setCurrent(null);
  };
  return (
    <>
      {/* 十字淡化：新图在下、旧图在上；旧图淡出即露出新图。旧图必须复用同一份 style
          （定位/运镜变量），且**不带 .entering**——带了就会被 sprite-in 从透明起步，
          等于一挂上就没了（旧实现的交叉淡化就是这么失效的）。 */}
      <img className={cls} style={style} src={current} alt={name} onError={onError} />
      {outgoing && (
        <img
          className={`theater-sprite pos-${pos} sprite-out${dim ? " dim" : ""}`}
          style={style}
          src={outgoing}
          alt=""
          aria-hidden
        />
      )}
    </>
  );
}

/** 全屏闪光色。剧本只写 white/red/black，落到具体色值。 */
const FLASH_COLORS: Record<string, string> = { white: "#ffffff", red: "#d0342c", black: "#000000" };
/** 一次性效果的时长（与 stage.css 的动画时长对齐）。 */
const FLASH_MS = 420;
const SHAKE_MS = { light: 340, heavy: 560 } as const;

/**
 * 一次性舞台效果：`seq` 变化就播一次，`durationMs` 后摘掉。与 Sprite 的 acting 同一套机制
 * ——同一个效果连写两次要能重播（seq 递增），播完不能一直占着（否则运镜/抖动的通道被锁死）。
 *
 * `muted`（回看中）时整段跳过且**不更新 last**：回看会把状态折回过去（seq 变小），
 * 若在回看里跟进 seq，回到播放头那一刻 seq 又跳回来，等于凭空补放一次闪光/抖动。
 * 不跟进 last，回看期间安静、回现场时 seq 与离开前一致，不会误触发。
 */
function useOneShot(seq: number | null | undefined, durationMs: number, muted = false): { active: boolean; nonce: number } {
  const [active, setActive] = useState(false);
  const [nonce, setNonce] = useState(0);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (muted) return;
    if (seq === null || seq === undefined || seq === last.current) return;
    last.current = seq;
    setActive(true);
    setNonce((n) => n + 1);
    const timer = setTimeout(() => setActive(false), durationMs);
    return () => clearTimeout(timer);
  }, [seq, durationMs, muted]);
  return { active, nonce };
}

/** 舞台：背景/立绘/CG 视觉层 + 打字机对话框 + 二段式点击 + 自动模式 + sfx/bgm + 语音 + 导演工具栏（右上角）。 */
export function StageTheater({
  visual,
  playback,
  live,
  fresh,
  names,
  index,
  voiceAvailable,
  busy,
  targets,
  onPrompt,
  promptAlt = "fork",
  showGenerate = true,
  onEdit,
  onFork,
  onGenerateCg,
  onReplay,
voiceState,
  voiceOn,
  onToggleVoice,
  onUnlock,
  onView,
  canContinue,
  onContinue,
  ended = false,
  onTurbo,
  overlay,
  directorBar = true,
}: StageTheaterProps) {
  /**
   * 循环音轨：BGM 与环境音各一路，都带交叉淡入淡出。缺省音量分别是 0.28 / 0.16——
   * 环境音是垫在配乐底下的背景声，压过配乐就变吵了。
   */
  const channels = useRef<{ bgm: LoopChannel; ambient: LoopChannel; sfx: SfxPlayer } | null>(null);
  if (!channels.current) {
    channels.current = { bgm: new LoopChannel(0.28), ambient: new LoopChannel(0.16), sfx: new SfxPlayer() };
  }
  useEffect(() => {
    const created = channels.current!;
    return () => {
      created.bgm.dispose();
      created.ambient.dispose();
      created.sfx.dispose();
    };
  }, []);
  /** 导演栏的面板：几个动作的全部输入都在对话框里收，不跳视图。 */
  const [action, setAction] = useState<DirectorAction | null>(null);
  const [draft, setDraft] = useState("");
  /** 生图选项：参考立绘（多选有序）与是否基于历史（默认勾上） */
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [useHistory, setUseHistory] = useState(true);
  /** 「提示」面板走哪条岔：引导 = 排进待注入队列跟着这一轮写，分岔 = 先退开再落笔。 */
  const [guideMode, setGuideMode] = useState<GuideMode>("guide");
  /** 净画面：藏掉压在画面上的台词条与导演栏，只剩背景/立绘/CG。点画面或按 H/空格/Esc 回来。 */
  const [hideUi, setHideUi] = useState(false);
  const { view, viewLength, current, shownLength, exhausted, advance, scrub, scrubbed, follow } =
    playback;
  const shown = view ? view.text.slice(0, viewLength) : "";
  const lineDone = current !== null && shownLength >= current.text.length;
  /** 全屏标题卡：整卡铺满画面、对话框让位（见 docs/features/261007-dsl-title）。 */
  const isTitle = view?.type === "title";
  /**
   * 标题卡正文已全部显示（逐句模式 = 末句已出）→ 再点一下离开。
   * 用最后一个揭示断点判，而不是 `shown === view.text`：正文常带尾随换行（模型把 `</title>`
   * 另起一行），而尾随空行不占揭示步，字面比对会永远差一个换行、提示永不出现。
   */
  const titleReady =
    isTitle &&
    view !== null &&
    current?.closed === true &&
    shown.length >= (titleStepEnds(view.text).at(-1) ?? 0);
  // 名牌与正文的归属交给纯函数判：这几者的优先级踩过一次坑，不在 JSX 里重排。
  const dialog = dialogContent({
    viewName:
      view && (view.type === "say" || view.type === "thought")
        ? (view.nameOverride ?? (actorName(names, view.actorId) || "？"))
        : null,
    shown,
    hasView: view !== null,
    live,
  });
  // 空对话区的「还没开演」是第三种说法：dialogContent 只分「演出中 / 等玩家」两态，
  // 树还空着时说「剧作家正在落笔…」是在撒谎。只在这一态换掉那句话。
  const dialogBody = !view && fresh ? emptyDialogHint(live, fresh) : dialog.text;
  // 说话者聚焦：当前这句台词的人保持原亮度，同框的其余人压暗。规则见 speakerFocusId。
  const focusId = speakerFocusId(view, visual.sprites);

  /**
   * 舞台点击：回看中 → 往回追一句；等新内容时（pause 停止点）→ 直接开新一轮。
   * 翻下一句和继续生成是同一个动作。空格共用这一套——点不动画面时（桌面键盘），
   * 那一下也得有着落。玩家的回执（input 行）不需要「收掉」：它就是缓冲里的普通一行，
   * 播放头走到它显示、走到下一句让位，与其他台词同一待遇。
   */
  const onStageClick = useCallback((): void => {
    onUnlock();
    if (hideUi) {
      setHideUi(false);
      return;
    }
    // 终局态：点舞台什么都不做（只剩「翻句」也不会真翻出内容——播放头已到末尾）。
    if (ended) return;
    if (scrubbed) scrub(1);
    // 正在显示标题卡时，点击只归标题卡自己（翻下一句 / 末句读完离开 / 流式未闭合时等它写完）。
    // 优先级必须高于「继续生成」：标题卡若是这一拍最后一条内容，继续出口会把它一click跳过，
    // 对话框都没恢复就开下一轮。
    else if (isTitle) advance();
    else if (canContinue) onContinue();
    else advance();
  }, [onUnlock, hideUi, ended, scrubbed, scrub, isTitle, canContinue, onContinue, advance]);

  // 回看：滚轮/↑ 往回翻，下滚/↓/←/→ 往回追；空格 = 点舞台。输入框内不劫持按键。
  const theaterRef = useRef<HTMLDivElement | null>(null);
  /** 两块浮层的实测高度写回 CSS 变量：选肢层据此卡在它们中间那一段（见 .choice-overlay）。 */
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const directorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = theaterRef.current;
    const dialog = dialogRef.current;
    if (!root || !dialog) return;
    const director = directorRef.current;
    const measure = (): void => {
      root.style.setProperty("--dialog-h", `${dialog.offsetHeight}px`);
      // 没有导演栏（directorBar=false）时必须显式写 0：CSS 缺省值是 46px，
      // 留着它，选肢层的底部留白会凭空多出一条缝。
      root.style.setProperty("--dir-h", `${director?.offsetHeight ?? 0}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(dialog);
    if (director) ro.observe(director);
    return () => ro.disconnect();
  }, [directorBar]);
  useEffect(() => {
    const el = theaterRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < 4) return;
      scrub(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrub]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      // 上面还浮着模态浮层（工坊抽屉）时 Esc 归那层，别连带把舞台的导演注也撤了
      if (e.key === "Escape" && escapeClaimed()) return;
      // 净画面态：按键只有一件事——把界面带回来。别在这里 scrub/advance，
      // 否则想安安静静看张图，方向键却把台词翻过去了。
      if (hideUi) {
        if (e.key === "h" || e.key === "H" || e.key === " " || e.key === "Escape") {
          setHideUi(false);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        scrub(-1);
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        scrub(1);
        e.preventDefault();
      } else if (e.key === " ") {
        // 空格与点舞台同一个动作（翻下一句 / 继续生成）。导演输入面板开着时不越层操作。
        if (!action) onStageClick();
        e.preventDefault();
      } else if (e.key === "Escape" && scrubbed) {
        scrub(1);
        e.preventDefault();
      } else if (e.key === "Escape" && action) {
        setAction(null);
        setDraft("");
        e.preventDefault();
      } else if (e.key === "l" || e.key === "L") {
        onView("backlog");
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scrub, scrubbed, action, onView, hideUi, onStageClick]);

  // 快进档：按住 Ctrl 追到缓冲末端，松开立刻回到原节奏。
  // 失焦也撤档——切出去时 Ctrl 可能停在按下状态，回来就变成永远在快进。
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === "Control" && !isTyping(e.target)) onTurbo(true);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.key === "Control") onTurbo(false);
    };
    const blur = (): void => onTurbo(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onTurbo]);

  // 触屏手势：左右滑 = 桌面方向键（scrub 回看/追进），上滑 = 回顾。
  // 没有下滑：它跟浏览器下拉刷新撞车，两边都按不准。横向本来也该给系统，但方向键语义更常用，这里接管。
  const touchRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent): void => {
    onUnlock();
    const t = e.touches[0];
    if (t) touchRef.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touchRef.current;
    touchRef.current = null;
    // 净画面态不接手势：滑一下是想看图，不是想翻句。轻点走 click 恢复界面。
    if (hideUi) return;
    if (!start) return;
    const end = e.changedTouches[0];
    if (!end) return;
    if (Date.now() - start.at > 800) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < 45 && Math.abs(dy) < 45) return;
    if (Math.abs(dx) > Math.abs(dy)) scrub(dx > 0 ? -1 : 1);
    else if (dy < 0) onView("backlog");
  };

  // sfx：key 变化即播放（同帧连发不叠加成噪音，挤掉最老的一小声）
  useEffect(() => {
    const cue = playback.sfx;
    if (!cue) return;
    const url = index.sfx(cue.src);
    if (url) channels.current!.sfx.play(url, cue.volume ?? 0.7);
  }, [playback.sfx, index]);

  // bgm / ambient：换曲交叉淡入淡出，null 即停。素材缺失时静默保持静音（不阻塞演出）
  const bgmUrl = index.bgm(visual.bgm);
  const ambientUrl = index.ambient(visual.ambient);
  useEffect(() => {
    channels.current!.bgm.set(bgmUrl, visual.bgmVolume);
  }, [bgmUrl, visual.bgmVolume]);
  useEffect(() => {
    channels.current!.ambient.set(ambientUrl, visual.ambientVolume);
  }, [ambientUrl, visual.ambientVolume]);

  // 纯色场（黑场/白场/任意色）不走素材表：`bg` 是保留色名或十六进制时直接画一块底。
  const sceneBg = resolveSceneBg(visual.bg ?? undefined);
  const bgColor = sceneBg?.kind === "color" ? sceneBg.color : null;
  const bgAssetId = sceneBg?.kind === "asset" ? sceneBg.id : null;
  const bgUrl = index.bg(bgAssetId);
  const cgUrl = index.cg(visual.cg?.id ?? null);
  // D6：引用的资产正在生成 → 骨架占位（台词照常演出），到货后 crossfade 替换
  const bgPending = !bgUrl && bgAssetId !== null && visual.pending[bgAssetId]?.type === "bg";
  const cgId = visual.cg?.id ?? null;
  const cgPending = !cgUrl && !!cgId && visual.pending[cgId]?.type === "cg";

  // 换层过渡：需要旧画面留在下层（dual-source）。旧图取不回来（素材缺）就退化为单层淡入。
  const bgFromUrl = visual.bgTransition?.from ? index.bg(visual.bgTransition.from) : null;
  const bgStack = visual.bgTransition && visual.bgTransition.from !== null ? visual.bgTransition : null;
  const bgVeil = bgStack ? transitionVeilColor(bgStack.name) : null;
  // 舞台效果：镜头抖（一次性，靠 seq 重播）与屏幕遮罩（闪光一次性；黑边/暗角持续）。
  const shakeSlot = visual.fx.camera.shake;
  const shakeValue = shakeSlot?.value === "heavy" ? "heavy" : "light";
  const shake = useOneShot(shakeSlot?.seq, SHAKE_MS[shakeValue], scrubbed);
  const shakeHold = shakeSlot?.on === true;
  const flashSlot = visual.fx.screen.flash;
  const flashValue = flashSlot?.value ?? "white";
  const flash = useOneShot(flashSlot?.seq, FLASH_MS, scrubbed);
  const flashHold = flashSlot?.on === true;

  /** 第二岔是哪一个：宿主说了算（见 `promptAlt`）。 */
  const altMode: GuideMode = promptAlt === "interrupt" ? "interrupt" : "fork";

  const submitAction = (): void => {
    const text = draft.trim();
    const act = effectiveAction(action, guideMode);
    setDraft("");
    setAction(null);
    if (act === "prompt" || act === "interrupt") {
      // 引导：只是排进待注入队列，不动分支也不吃掉停止点——选项还摆着，玩家照选不误。
      // 打断：宿主那边会先停下这一轮再把这句投进去，同样不动停止点。
      if (text) onPrompt(text, act === "interrupt" ? "interrupt" : "guide");
      return;
    }
    if (act === "edit") {
      if (text && targets.lineNodeId) onEdit(targets.lineNodeId, text);
      return;
    }
    if (act === "cg") {
      onGenerateCg(text, {
        referenceCharacters: selectedRefs.length > 0 ? selectedRefs : undefined,
        useHistory,
        // 回看着的那一行就是这张图的归处：提示词照那一刻写，图挂回那一行旁边。
        // 这一行还没进谱系（刚演到这儿）就传 null——服务端会拒，而不是悄悄落到世界线末尾。
        anchorNodeId: scrubbed ? (targets.lineNodeId ?? view?.nodeId ?? null) : undefined,
      });
      return;
    }
    if (act === "restart") {
      if (!targets.beatId) return;
      // 交代的那句跟着这一岔一起发：它是重演这一轮的第一条输入，不是排到下一轮。
      onFork(targets.beatId, {
        resume: true,
        ...(targets.beatNodeId ? { replaced: targets.beatNodeId } : {}),
        ...(text ? { instruction: text } : {}),
      });
      return;
    }
    // 分岔：从**正在看的这一行**退开（传 seq，由服务端解析成落点），不是从整轮开头。
    // 轮内分岔 = 腰斩：正在写的后半截就此作废，旧分支停在它演到的位置。
    if (targets.lineSeq === null) return;
    // 填了的这句就是新分支这一轮的第一条输入；留空则新分支开出来后停在等你开口。
    onFork(targets.lineSeq, text ? { instruction: text } : undefined);
  };

  /** 当前显示行的语音状态：合成中也占一个喇叭位（闪烁），别让「正在生成」看起来像「没有语音」。 */
  const voice = voiceState(view?.seq ?? null);

  /**
   * 置灰只该因为「此刻确实做不了」。busy 优先于锚点缺失：演出进行中时锚点多半也是空的，
   * 但那会显示成「这里没有台词可改」——玩家会以为是自己看错了，其实只是还没轮到他。
   */
  const editBlock = busy ? "演出进行中，暂时不能改写" : targets.lineNodeId ? null : "这里没有剧作家的台词可改";
  const beatBlock = busy ? "演出进行中，暂时不能重写" : targets.beatId ? null : "这里还没有可退回去的一轮";
  // 分岔不因 busy 置灰：玩家说「就到这里」随时成立，正在写的那半截就此腰斩。
  const forkBlock = targets.lineSeq === null ? "这里还没有可分岔的位置" : null;

  /** 提交按哪条岔走：只有「提示」面板有两种（引导 / 另一岔），其余动作单一。 */
  const modalAction = effectiveAction(action, guideMode);

  /**
   * 送不出去的五种情形，没有第六种：
   *  - 改写必须真写一句（没内容就无从改起）
   *  - 引导必须有话可排（空句进队列等于没排）
   *  - 分岔/重写要有落点（还没演到任何一行）
   *  - 生图：勾了历史可留空，未勾历史必须填指令（见 cgCanSubmit）
   */
  const submitDisabled: boolean =
    modalAction === "edit"
      ? draft.trim() === "" || !targets.lineNodeId
      : modalAction === "prompt"
        ? draft.trim() === ""
        : modalAction === "fork"
          ? forkBlock !== null
          : modalAction === "restart"
            ? targets.beatId === null
            : modalAction === "cg"
              ? !cgCanSubmit(draft, useHistory)
              : false;

  return (
    <div
      className={`theater stage-root${hideUi ? " bare" : ""}${isTitle ? " title-mode" : ""}`}
      ref={theaterRef}
      onClick={onStageClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* 顶栏（游戏 HUD 式的 exit/log/branch/studio）在 StageScreen 里，浮于三个视图之上 */}

      <div className={`theater-stage${scrubbed ? " rewinding" : ""}`}>
        {/* 镜头容器（画面内容变换层）：抖动作用在这一层，背景/立绘/CG 因此一起动。
            letterbox、暗角、闪光留在容器之外的屏幕遮罩层——它们是「画面框」，不该跟着抖。 */}
        <div
          className={`theater-camera${
            shake.active || shakeHold ? ` shaking shake-${shakeValue}${shakeHold ? " shake-hold" : ""}` : ""
          }`}
          style={
            {
              "--shake-ms": `${SHAKE_MS[shakeValue]}ms`,
              "--shake-nonce": `-${(shake.nonce % 100) / 1000}s`,
            } as CSSProperties
          }
        >
        {/* 背景：换层时旧图留在下层、新图按 transition 盖上来（dual-source）。
            旧图取不回来（素材缺）或首次上屏（没有 from）就退化为单层淡入。 */}
        {bgUrl && !bgStack ? (
          <img key={bgUrl} className="theater-bg theater-bg-in" src={bgUrl} alt="" />
        ) : bgStack ? (
          <div key={bgStack.seq} className={`theater-bg-stack theater-stack trans-${bgStack.name}${scrubbed ? " rewinding" : ""}`}>
            {bgFromUrl && <img className="theater-bg theater-stack-old" src={bgFromUrl} alt="" aria-hidden />}
            {bgUrl ? (
              <img className="theater-bg theater-stack-new" src={bgUrl} alt="" />
            ) : (
              <div className={`theater-bg theater-stack-new theater-bg-fallback${bgPending ? " theater-bg-pending" : ""}`} />
            )}
            {bgVeil && <span className="theater-stack-veil" style={{ background: bgVeil }} />}
          </div>
        ) : (
          <div
            className={`theater-bg theater-bg-fallback${bgPending ? " theater-bg-pending" : ""}`}
            style={bgColor ? { background: bgColor } : undefined}
          />
        )}

        {/* 立绘层自带层叠上下文：下面的 orderSeq 与「说话者置顶」只在这一层里比，
            不参与外层——否则说话者（+1000）会压过台词条（12）、选肢层（15）与
            工具条（20）；整层也落在选肢遮罩（8）之下，遮罩能把它一并压暗。 */}
        <div className="theater-sprites">
          {Object.entries(visual.sprites).map(([id, slot]) => {
            // 立绘目录可能不叫这个演员的 id（卡上写了 `sprite:`）：先解绑定，下面几个查询吃的都是目录名
            const dir = index.spriteDirOf(id);
            // 呈现三轴：取景与体量只听素材声明（剧本管不着图里画到哪、台上站多大），
            // 对齐则是「剧本写了用剧本的，没写听素材声明的」（机甲默认居中悬空、道具贴地）。
            const presentation = index.spritePresentation(dir, slot.variant);
            const isSpeaking = focusId === id;
            // 层级：后上场的更高（orderSeq），正在说话的角色额外 +1000 置于最顶层
            const zIndex = (slot.orderSeq || 1) + (isSpeaking ? 1000 : 0);
            return (
              <Sprite
                key={id}
                url={index.sprite(dir, slot.variant)}
                pos={slot.resolvedPos}
                name={actorName(names, id)}
                framing={presentation.framing}
                stature={presentation.stature}
                shot={slot.shot}
                anchor={slot.anchor ?? presentation.anchor}
                leaving={slot.leaving === true}
                action={slot.action}
                actionSeq={slot.actionSeq}
                zIndex={zIndex}
                dim={focusId !== null && !isSpeaking}
              />
            );
          })}
        </div>

        {cgUrl && (
          <div className="theater-cg">
            <img className="theater-cg-in" src={cgUrl} alt={visual.cg?.id ?? ""} />
            {visual.cg?.caption && <p className="theater-cg-caption">{visual.cg.caption}</p>}
          </div>
        )}
        {cgPending && (
          <div className="theater-cg theater-cg-pending" aria-label="插图生成中">
            {visual.cg?.caption && <p className="theater-cg-caption">{visual.cg.caption}</p>}
          </div>
        )}
        </div>

        {/* 屏幕遮罩层：flash / letterbox / 暗角。都在镜头容器之外——它们叠加在画面上，
            画面内容抖动时它们不动。 */}
        <div className="theater-overlay" aria-hidden="true">
          {visual.fx.screen.letterbox?.on && <span className="theater-letterbox" />}
          {visual.fx.screen.vignette?.on && <span className="theater-vignette" />}
          {flashHold ? (
            <span className="theater-flash theater-flash-hold" style={{ background: FLASH_COLORS[flashValue] ?? "#fff" }} />
          ) : flash.active ? (
            <span key={flash.nonce} className="theater-flash" style={{ background: FLASH_COLORS[flashValue] ?? "#fff" }} />
          ) : null}
        </div>

        {/* 全屏标题卡：整屏铺文本，对话框让位（.theater.title-mode 里藏掉）。
            逐句模式下 `shown` 是导演按已揭示句数截出的前缀，这里只管按对齐铺出去。 */}
        {isTitle && view && (
          <div className={`theater-title title-align-${view.align ?? "center"}`} role="heading" aria-level={1}>
            <p className="theater-title-text">{shown}</p>
            {titleReady && (
              <span className="theater-title-next" aria-hidden>
                ▼
              </span>
            )}
          </div>
        )}

        {/* 选肢层挂在 .theater 上（不在画面区里）：台词条是叠在画面上的，
            「铺满画面区」等于铺到台词条底下，卡片会被盖住点不到。见 .choice-overlay。 */}
      </div>

      {/* 选肢层：导演栏与台词条之间那一段，画面层之上、台词条之下。
          净画面态整层不渲染（不是 display:none）：它带着压暗舞台的遮罩
          （.theater:has(.choice-overlay)），藏掉卡片却留着遮罩，看到的还是暗的。 */}
      {/* 标题卡期间不摆停止点/继续出口：title 与 stop 不同时在场（stop 写在 </title> 之后），
          先点掉标题卡、对话框恢复，选项才出现。 */}
      {!hideUi && !isTitle && overlay}

      {/* 导演工具栏（提示/改写/重写/生图/重听）：舞台右上角浮层。点击动作 stopPropagation，
           不劫持舞台的继续/回看手势。分岔不在这里——它是「提示」面板里的一条岔
           （引导/分岔两选一），单独再挂一个键只是把同一个决定拆成两处。
           宿主没有落点（directorBar=false）时整块不渲染：没有工具栏，也就没有它开的那些面板。 */}
      {directorBar && (
        <div className="theater-director" ref={directorRef}>
          <button
            type="button"
            className={`dir-btn ${action === "prompt" ? "on" : ""}`}
            title="输入角色的行动、台词，或给这场戏的指示"
            aria-label="提示"
            onClick={(e) => {
              e.stopPropagation();
              setAction(action === "prompt" ? null : "prompt");
              setDraft("");
            }}
          >
            <Icon name="chat" size={17} />
            提示
          </button>
          <button
            type="button"
            className={`dir-btn ${action === "edit" ? "on" : ""}`}
            title={editBlock ?? "编辑当前这句台词"}
            aria-label="改写当前这句台词"
            disabled={editBlock !== null}
            onClick={(e) => {
              e.stopPropagation();
              setAction(action === "edit" ? null : "edit");
              setDraft(targets.lineText);
            }}
          >
            <Icon name="pencil" size={17} />
            改写
          </button>
          <button
            type="button"
            className={`dir-btn ${action === "restart" ? "on" : ""}`}
            title={beatBlock ?? "重写：退到这一轮之前，让剧作家重新写一遍（原有内容留作旧枝）"}
            aria-label="重写这一轮"
            disabled={beatBlock !== null}
            onClick={(e) => {
              e.stopPropagation();
              setAction(action === "restart" ? null : "restart");
              setDraft("");
            }}
          >
            <Icon name="rewrite" size={17} />
            重写
          </button>
          {showGenerate && (
          <button
            type="button"
            className={`dir-btn ${action === "cg" ? "on" : ""}`}
            title={fresh ? "还没有剧情可以入画" : "为这一幕生成一张插图（指令可留空）"}
            aria-label="生成插图"
            disabled={fresh}
            onClick={(e) => {
              e.stopPropagation();
              if (action === "cg") {
                setAction(null);
              } else {
                setAction("cg");
                setDraft("");
                setSelectedRefs([]);
                setUseHistory(true);
              }
            }}
          >
            <Icon name="assets" size={17} />
            生图
          </button>
          )}
          {voiceAvailable && voice !== "none" && (
            <button
              type="button"
              className={`dir-btn ${voice === "pending" ? "voice-pending" : ""}`}
              title={voice === "pending" ? "语音合成中" : !voiceOn ? "语音已关，先打开语音再重听" : "重听这句"}
              aria-label={voice === "pending" ? "语音合成中" : "重听这句"}
              disabled={voice === "pending" || !voiceOn}
              onClick={(e) => {
                e.stopPropagation();
                if (voice === "ready" && view?.seq !== null && view?.seq !== undefined) onReplay(view.seq);
              }}
            >
              <Icon name="volume" size={17} />
              重听
            </button>
          )}
        </div>
      )}

      <div className="theater-dialog" role="text" ref={dialogRef}>
        {/* 名牌：整块落在台词条上方、跟窗的上边缘连着（不留缝），左端跟窗的左边缘对齐。
            骑在窗沿上会把它切成两半，所以是「贴着」，不是「压着」。 */}
        {dialog.name && <div className="dialog-name">{dialog.name}</div>}
        {/* 玩家回执（input 行）与其他台词同一待遇：播放头走到它就整行显示（不打字机）。 */}
        <p className={`dialog-text ${view?.type === "thought" ? "thought" : view?.type === "narrate" ? "narrate" : ""} ${scrubbed ? "rewinding" : ""}`}>
          {dialogBody}
          {view && !scrubbed && !lineDone && <span className="dialog-caret" aria-hidden />}
        </p>
        {/* 台词条底缘：左是状态提示（回看中 / 生成中），右是游戏选项 */}
        <div className="dialog-foot">
          <div className="dialog-hint dialog-hint-foot">
            {scrubbed ? (
              <button type="button" className="dialog-rewind" onClick={follow} title="回到最新">
                <Icon name="prev" />
                回看中
              </button>
            ) : action ? null : (
              <>
                {live && <span className="dialog-spinner" aria-label="剧作家正在写" />}
                {lineDone && (!exhausted || canContinue) && (
                  <span className="dialog-next" aria-hidden>
                    ▼
                  </span>
                )}
                {canContinue && <span className="muted">点击舞台继续生成</span>}
              </>
            )}
          </div>
          {/* 游戏选项：Auto / Voice / Back / Hide，落在对话框右下角。导演动作见舞台右上角的工具栏。
              纯文字无图标：开关态由字面自己说（Auto/Manual、Voice/Muted），
              不靠图标形状，也不用额外的状态标记。 */}
          <div className="dialog-options">
            <button
              type="button"
              className={`dir-btn ${playback.auto ? "tgl-on" : ""}`}
              title={playback.auto ? "Auto-play: on (tap to turn off)" : "Auto-play: off (tap to turn on)"}
              aria-pressed={playback.auto}
              onClick={(e) => {
                e.stopPropagation();
                playback.setAuto(!playback.auto);
              }}
            >
              {playback.auto ? "Auto" : "Manual"}
            </button>
            {voiceAvailable && (
              <button
                type="button"
                className={`dir-btn ${voiceOn ? "tgl-on" : ""}`}
                title={voiceOn ? "Voice: on (tap to turn off)" : "Voice: off (tap to turn on)"}
                aria-pressed={voiceOn}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVoice();
                }}
              >
                {voiceOn ? "VOICE" : "MUTED"}
              </button>
            )}
            <button
              type="button"
              className="dir-btn"
              title="Rewind one line (←)"
              disabled={!scrubbed && playback.history.length === 0}
              onClick={(e) => {
                e.stopPropagation();
                scrub(-1);
              }}
            >
              BACK
            </button>
            <button
              type="button"
              className="dir-btn"
              title="Hide the interface — tap the picture or press H / Space to bring it back"
              onClick={(e) => {
                e.stopPropagation();
                setAction(null);
                setDraft("");
                setHideUi(true);
              }}
            >
              HIDE
            </button>
          </div>
        </div>

        {action && (
          <Modal
            title={action === "prompt" ? "提示" : ACTION_META[action].title}
            hint={action === "prompt" ? GUIDE_HINT[guideMode] : ACTION_META[action].hint}
            onClose={() => setAction(null)}
            footer={
              <>
                <button
                  type="button"
                  className="primary"
                  onClick={submitAction}
                  disabled={submitDisabled}
                >
                  {ACTION_META[modalAction].submit(draft.trim())}
                </button>
                <button type="button" className="ghost-btn" onClick={() => setAction(null)}>
                  取消
                </button>
              </>
            }
          >
            {/* 「提示」的两条岔：引导 = 顺着这一轮写（排进待注入队列，停止点不动），
                分岔 = 从正在看的这一行退开再落笔。两件事同一处决定，别拆成两个键。 */}
            {action === "prompt" && (
              <div className="seg guide-seg">
                <button
                  type="button"
                  className={`seg-btn ${guideMode === "guide" ? "active" : ""}`.trim()}
                  aria-pressed={guideMode === "guide"}
                  title="跟下一轮一起发"
                  onClick={() => setGuideMode("guide")}
                >
                  引导
                </button>
                <button
                  type="button"
                  className={`seg-btn ${guideMode === altMode ? "active" : ""}`.trim()}
                  aria-pressed={guideMode === altMode}
                  // 分岔要一个落点（正在看的这一行）；打断随时成立，没有可置灰的情形。
                  title={altMode === "interrupt" ? GUIDE_HINT.interrupt : (forkBlock ?? "从这一行开新分支。")}
                  disabled={altMode === "fork" && forkBlock !== null}
                  onClick={() => setGuideMode(altMode)}
                >
                  {altMode === "interrupt" ? "打断" : "分岔"}
                </button>
              </div>
            )}
            {/* 生图选项：参考立绘（多选有序）+ 基于历史开关 */}
            {action === "cg" && (
              <>
                <div className="image-gen-field">
                  <span className="image-gen-label">参考立绘（按点选顺序垫图）：</span>
                  <RefCharacterPicker
                    // 候选 = 有立绘的主体（目录扫出来的），不是角色表：机甲、道具没有卡也能垫。
                    // 名字先问绑定它的那张卡（目录名与角色 id 可以不同名），再落舞台名牌、最后才是目录名
                    candidates={index.spriteIds
                      .map((id) => ({
                        id,
                        name: index.spriteName(id) ?? names[id] ?? id,
                        spriteUrl: index.sprite(id, null),
                      }))
                      .filter((c): c is RefCandidate => Boolean(c.spriteUrl))}
                    selected={selectedRefs}
                    onToggle={(id) => setSelectedRefs((prev) => toggleReference(prev, id))}
                  />
                </div>
                <label className="image-gen-checkbox">
                  <input
                    type="checkbox"
                    checked={useHistory}
                    onChange={(e) => setUseHistory(e.target.checked)}
                  />
                  <span>基于刚才演到的剧情与场景</span>
                </label>
              </>
            )}
            <div className="director-input">
              {action === "prompt" && (
                <button
                  type="button"
                  className={`ooc-shortcut ${draft.startsWith(OOC_PREFIX) ? "on" : ""}`}
                  title="以 OOC 开头 = 跳出角色，直接下指令"
                  aria-label="以 OOC 前缀给剧作家下指令"
                  onClick={() =>
                    setDraft((prev) =>
                      prev.startsWith(OOC_PREFIX) ? prev.slice(OOC_PREFIX.length) : OOC_PREFIX + prev,
                    )
                  }
                >
                  OOC：
                </button>
              )}
              <input
                value={draft}
                placeholder={action === "prompt" ? ACTION_META[modalAction].placeholder : ACTION_META[action].placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  submitAction();
                }}
              />
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

/**
 * 回顾：整屏重读这一场说过的所有话——剧作家的台词、玩家的选择与输入、导演注。
 *
 * 点一行不再直接跳回那一刻：翻到过去是为了在这儿做点什么（重听、改写、由此分岔），
 * 所以每条下面挂一排动词按钮，跳回舞台只是其中一个。点正文本身不做任何事，避免误触。
 *
 * 「回顾 / 原始历史」这组切换由外层放进侧栏的工具段（视图切换属于导航，不该再横一条），
 * 这里只出内容。
 */
export function BacklogView({
  entries,
  names,
  headKey,
  busy,
  voiceAvailable,
  voiceState,
  beatFor,
  onSeek,
  onReplay,
  onEdit,
  onFork,
}: {
  entries: readonly TranscriptEntry[];
  names: Readonly<Record<string, string>>;
  headKey: string | null;
  busy: boolean;
  voiceAvailable: boolean;
  voiceState: (seq: number | null) => VoiceState;
  /** 这一条落在哪一轮（重写要的两个锚点：退到哪儿、来源标签按谁算）；玩家自己发来的话没有轮，返 null。 */
  beatFor: (entry: TranscriptEntry) => { anchor: string; replaced: string } | null;
  onSeek: (key: string) => void;
  onReplay: (seq: number) => void;
  onEdit: (nodeId: string, text: string) => void;
  /** 重写：重演这一轮，会分出一条新线。 */
  onFork: (nodeId: string, opts?: { resume?: boolean; replaced?: string; instruction?: string }) => void;
}) {
  /** 改写就地改：点开编辑框在回顾里完成，不跳视图。 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="backlog-panel">
      {entries.length === 0 ? (
        <p className="backlog-empty">还没有说出口的话。</p>
      ) : (
        <ol className="backlog-list">
          {entries.map((item) => {
            const beat = beatFor(item);
            const editable = item.kind === "line" && item.nodeId !== null;
            const playable = item.type === "say" && voiceAvailable && voiceState(item.seq) === "ready";
            return (
              <li key={item.key} className={`bl-${item.kind}`}>
                <div className={item.key === headKey ? "bl-text current" : "bl-text"}>
                  {item.actorId && <b>{actorName(names, item.actorId)}</b>}
                  <span>{item.text}</span>
                </div>
                {editing === item.key ? (
                  <div className="bl-edit">
                    <input
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && item.nodeId) {
                          onEdit(item.nodeId, draft.trim());
                          setEditing(null);
                        } else if (e.key === "Escape") {
                          setEditing(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={draft.trim() === ""}
                      onClick={() => {
                        if (!item.nodeId) return;
                        onEdit(item.nodeId, draft.trim());
                        setEditing(null);
                      }}
                    >
                      改写
                    </button>
                    <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  /* 动词带字样：几十像素的方块里分不出「重听」和「改写」，更看不出两个同义
                     按钮的区别。「分岔」只留一个——重新生成是分岔的副产品，不单列第二动词。 */
                  <div className="bl-tools">
                    <button
                      type="button"
                      className="bl-tool"
                      title="在舞台上重看到这一句"
                      onClick={() => onSeek(item.key)}
                    >
                      <Icon name="prev" size={14} />
                      回到舞台
                    </button>
                    {playable && (
                      <button
                        type="button"
                        className="bl-tool"
                        title="重听这句"
                        onClick={() => item.seq !== null && onReplay(item.seq)}
                      >
                        <Icon name="play" size={14} />
                        重听
                      </button>
                    )}
                    {editable && (
                      <button
                        type="button"
                        className="bl-tool"
                        title="就地改写这句"
                        onClick={() => {
                          setEditing(item.key);
                          setDraft(item.text);
                        }}
                      >
                        <Icon name="pencil" size={14} />
                        改写
                      </button>
                    )}
                    <button
                      type="button"
                      className="bl-tool"
                      title={busy ? "演出进行中，暂时不能重新生成" : "重新生成这一轮（从这一轮开头分岔并立刻续演）"}
                      disabled={busy || !beat}
                      onClick={() => beat && onFork(beat.anchor, { resume: true, replaced: beat.replaced })}
                    >
                      <Icon name="rewrite" size={14} />
                      重新生成
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
