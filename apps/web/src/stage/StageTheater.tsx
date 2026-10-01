import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { dialogContent } from "./playbackState.js";
import { actorName } from "./script.js";
import type { Playback, VisualState } from "./director.js";
import type { AssetIndex } from "./assets.js";
import { LoopChannel, SfxPlayer } from "./loopAudio.js";
import type { TranscriptEntry } from "./transcript.js";
import { api } from "../api.js";
import type { HistoryBeat, HistoryEntry } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { escapeClaimed } from "../ui/escape.js";
import { Modal } from "../ui/Modal.js";
import type { StageView } from "./view.js";

interface StageTheaterProps {
  visual: VisualState;
  playback: Playback;
  live: boolean;
  names: Readonly<Record<string, string>>;
  index: AssetIndex;
  /** 服务端 TTS 能力（false 时隐藏语音相关的一切）。 */
  voiceAvailable: boolean;
  /** 结构性操作会腰斩正在演的这一轮，busy 时 ✎/↺ 置灰（插一句仍可用，它排进待注入队列）。 */
  busy: boolean;
  /** 由当前显示行 seq 反查出的锚点：编辑绑行，重来绑整轮。 */
  targets: DirectorTargets;
  /** 插一句：唯一的输入通道。空闲时立刻开新轮，演出中排进待注入队列。 */
  onPrompt: (text: string) => void;
  onEdit: (nodeId: string, text: string) => void;
  onFork: (nodeId: string, opts?: { resume?: boolean }) => void;
  onReplay: (seq: number) => void;
  /** 这一行的语音处于哪一态：none=没配音色/不生成，pending=正在合成，ready=可重听。 */
  voiceState: (seq: number | null) => VoiceState;
  /** 玩家刚发出去的那一句（选项/自由输入）：谱系还没拉到，先在对话框里顶一句。 */
  playerEcho: string | null;
  onEchoDismiss: () => void;
  onUnlock: () => void;
  onView: (view: StageView) => void;
  /** 点舞台即开新轮：等到内容演完且存在 pause 停止点时成立（不再单列「继续」按钮）。 */
  canContinue: boolean;
  onContinue: () => void;
  /** 快进档：按住 Ctrl 期间为 true，松开/失焦回 false。 */
  onTurbo: (on: boolean) => void;
  /**
   * 停止点浮层（选肢卡、自由输入、no_stop 时的「（继续）」卡）。
   * 它挂在**画面区**里：只盖住背景与立绘，台词条、导演栏、侧栏都照常可点——
   * 选肢时要紧的只有「别手滑把这一轮点了过去」。
   */
  overlay?: ReactNode;
}

export interface DirectorTargets {
  beatId: string | null;
  lineNodeId: string | null;
  lineText: string;
}

/** 一行的语音状态。pending=已发去合成、音频还没到；图标在这两态之间切换。 */
export type VoiceState = "none" | "pending" | "ready";

/** 导演栏的四个动作。分岔与重新生成共用同一个锚点，区别只在分岔之后等不等待落笔。 */
type DirectorAction = "prompt" | "edit" | "restart" | "fork";

const ACTION_META: Record<
  DirectorAction,
  { title: string; hint: string; placeholder: string; submit: (draft: string) => string }
> = {
  prompt: {
    title: "提示词",
    hint: "写给剧作家的内容：角色的行动或台词、对这场戏的指示。演出中会排进待注入队列，在本轮收束后兑现。带 OOC：前缀 = 跳出角色直接下指令。",
    placeholder: "想让这场戏接下来怎么走…",
    submit: () => "发送",
  },
  edit: {
    title: "改写这句台词",
    hint: "就地改这一句，改完接着演，不重新生成。",
    placeholder: "改写这句台词…",
    submit: () => "改写",
  },
  restart: {
    title: "重新生成这一轮",
    hint: "从这一轮开头分岔并立刻续演，引擎自己换一种写法。留空 = 只重演；填了 = 顺带把意图给过去。",
    placeholder: "想换什么方向？（可留空）",
    submit: (d) => (d ? "重新生成 · 带着这句" : "重新生成"),
  },
  fork: {
    title: "分岔",
    hint: "退到这一轮开头开一条新分支，引擎停下来等你发话。留空 = 分岔后自己点舞台继续生成；填了 = 这句话直接进入新分支的第一轮。",
    placeholder: "给新分支的第一句话（可留空）",
    submit: (d) => (d ? "分岔 · 带着这句" : "分岔"),
  },
};

const POS_CLASS: Record<string, string> = { left: "pos-left", center: "pos-center", right: "pos-right" };

/** 输入态：输入框里的按键是文字的，不能被舞台的快捷键与快进档抢走。 */
function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** 插一句的快捷前缀：以它开头 = 明确指示，剧作家遵从但不跳出戏外回应。正文里也要认得这个。 */
const OOC_PREFIX = "OOC：";

/**
 * 立绘：表情差分之间交叉淡入。
 * 新图先在内存里解码好再叠上去，切换只是一层 opacity 过渡——不会出现白闪或半张脸。
 *
 * 加载失败（剧目里配的立绘文件已被删/改名）就地退场，不留浏览器那张裂图：
 * 没有立绘的舞台本来就该是空的，一张裂图反而像是引擎坏了。
 */
function Sprite({ url, pos, name }: { url: string | null; pos: string; name: string }) {
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

  if (!current) return null;
  const cls = `theater-sprite ${POS_CLASS[pos] ?? "pos-center"}`;
  const onError = (): void => {
    setOutgoing(null);
    setCurrent(null);
  };
  return (
    <>
      {outgoing && <img className={`${cls} sprite-out`} src={outgoing} alt="" aria-hidden />}
      <img className={cls} src={current} alt={name} onError={onError} />
    </>
  );
}

/** 舞台：背景/立绘/CG 视觉层 + 打字机对话框 + 二段式点击 + 自动模式 + sfx/bgm + 语音 + 导演栏。 */
export function StageTheater({
  visual,
  playback,
  live,
  names,
  index,
  voiceAvailable,
  busy,
  targets,
  onPrompt,
  onEdit,
  onFork,
  onReplay,
  voiceState,
  playerEcho,
  onEchoDismiss,
  onUnlock,
  onView,
  canContinue,
  onContinue,
  onTurbo,
  overlay,
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
  /** 导演栏的面板：四个动作的全部输入都在对话框里收，不跳视图。 */
  const [action, setAction] = useState<DirectorAction | null>(null);
  const [draft, setDraft] = useState("");
  const { view, viewLength, current, shownLength, exhausted, advance, scrub, scrubbed, follow } =
    playback;
  const shown = view ? view.text.slice(0, viewLength) : "";
  const lineDone = current !== null && shownLength >= current.text.length;
  // 名牌与正文的归属交给纯函数判：这三者的优先级踩过一次坑，不在 JSX 里重排。
  const dialog = dialogContent({
    playerEcho,
    viewName:
      view && (view.type === "say" || view.type === "thought")
        ? (view.nameOverride ?? (actorName(names, view.actorId) || "？"))
        : null,
    shown,
    hasView: view !== null,
    live,
  });

  // 回看：滚轮/↑ 往回翻，下滚/↓/←/→/空格 往回追。输入框内不劫持按键。
  const theaterRef = useRef<HTMLDivElement | null>(null);
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
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        scrub(-1);
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") {
        scrub(1);
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
  }, [scrub, scrubbed, action, onView]);

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

  /**
   * 舞台点击：回看中 → 往回追一句；玩家刚发出去的那句还顶在对话框里 → 先把它收掉；
   * 等新内容时（pause 停止点）→ 直接开新一轮。翻下一句和继续生成是同一个动作。
   */
  const onStageClick = (): void => {
    onUnlock();
    if (scrubbed) scrub(1);
    else if (playerEcho) {
      // 回声占着台词条时，这一下既是「我看过了」也是「往下走」——
      // 否则玩家点两下才看得见自己那句话之后的内容。
      onEchoDismiss();
      if (canContinue) onContinue();
      else advance();
    } else if (canContinue) onContinue();
    else advance();
  };

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

  const bgUrl = index.bg(visual.bg);
  const cgUrl = index.cg(visual.cg?.id ?? null);
  // D6：引用的资产正在生成 → 骨架占位（台词照常演出），到货后 crossfade 替换
  const bgPending = !bgUrl && !!visual.bg && visual.pending[visual.bg]?.type === "bg";
  const cgId = visual.cg?.id ?? null;
  const cgPending = !cgUrl && !!cgId && visual.pending[cgId]?.type === "cg";

  const submitAction = (): void => {
    const text = draft.trim();
    setDraft("");
    setAction(null);
    if (action === "prompt") {
      if (text) onPrompt(text);
      return;
    }
    if (action === "edit") {
      if (text && targets.lineNodeId) onEdit(targets.lineNodeId, text);
      return;
    }
    if (!targets.beatId) return;
    if (action === "restart") {
      onFork(targets.beatId, { resume: true });
      // 填了就当「提示词」紧跟着落进重演的那一轮里；留空就是纯粹重演。
      if (text) onPrompt(text);
      return;
    }
    // 分岔：不 resume——新分支开出来后引擎停在等你开口。填了提示词就直接开新一轮。
    onFork(targets.beatId);
    if (text) onPrompt(text);
  };

  /** 当前显示行的语音状态：合成中也占一个喇叭位（闪烁），别让「正在生成」看起来像「没有语音」。 */
  const voice = voiceState(view?.seq ?? null);

  /**
   * 置灰只该因为「此刻确实做不了」。busy 优先于锚点缺失：演出进行中时锚点多半也是空的，
   * 但那会显示成「这里没有台词可改」——玩家会以为是自己看错了，其实只是还没轮到他。
   */
  const editBlock = busy ? "演出进行中，暂时不能改写" : targets.lineNodeId ? null : "这里没有剧作家的台词可改";
  const beatBlock = busy ? "演出进行中，暂时不能重新生成" : targets.beatId ? null : "这里还没有可退回去的一轮";
  const forkBlock = busy ? "演出进行中，暂时不能分岔" : targets.beatId ? null : "这里还没有可分岔的一轮";

  return (
    <div
      className="theater"
      ref={theaterRef}
      onClick={onStageClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* 顶栏（游戏 HUD 式的 exit/log/branch/studio）在 StageScreen 里，浮于三个视图之上 */}

      <div className="theater-stage">
        {bgUrl ? (
          <img key={bgUrl} className="theater-bg theater-bg-in" src={bgUrl} alt="" />
        ) : (
          <div
            className={`theater-bg theater-bg-fallback ${bgPending ? "theater-bg-pending" : ""} ${
              visual.transition === "cut" ? "cut" : ""
            }`}
          />
        )}

        {Object.entries(visual.sprites).map(([id, slot]) => (
          <Sprite
            key={id}
            url={index.sprite(id, slot.expression)}
            pos={slot.pos ?? "center"}
            name={actorName(names, id)}
          />
        ))}

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

        {/* 停止点浮层只在画面区内：台词条与导演栏留在浮层之外，选肢期间照常可点可用。
            这里仍然吃触摸事件——舞台监听着左右滑（翻句）与上滑（看回顾）。 */}
        {overlay}
      </div>

      <div className="theater-dialog" role="text">
        {dialog.name && <div className="dialog-name">{dialog.name}</div>}
        {/* 回声期间台词条归它：玩家一按下就得看见自己说了什么，不能被上一句挡回去。
            真台词一到（播放头换行）回声自动让位，见 StageScreen 的 echoText。 */}
        <p className={`dialog-text ${!playerEcho && view?.type === "thought" ? "thought" : !playerEcho && view?.type === "narrate" ? "narrate" : ""} ${scrubbed ? "rewinding" : ""}`}>
          {dialog.text}
          {view && !playerEcho && !scrubbed && !lineDone && <span className="dialog-caret" aria-hidden />}
        </p>
        {/* 导演栏：四个原语 + 重听/自动，全在对话界面内就地完成，不跳视图 */}
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
          <div className="director-bar">
            <button
              type="button"
              className={`dir-btn ${action === "prompt" ? "on" : ""}`}
              title="提示词：写给剧作家的内容。演出中排进待注入队列，本轮收束后兑现"
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "prompt" ? null : "prompt");
                setDraft("");
              }}
            >
              <Icon name="chat" />
            </button>
            <button
              type="button"
              className={`dir-btn ${action === "edit" ? "on" : ""}`}
              title={editBlock ?? "改写当前这句台词"}
              disabled={editBlock !== null}
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "edit" ? null : "edit");
                setDraft(targets.lineText);
              }}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              className={`dir-btn ${action === "restart" ? "on" : ""}`}
              title={beatBlock ?? "重新生成这一轮（从这一轮开头分岔并立刻续演）"}
              disabled={beatBlock !== null}
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "restart" ? null : "restart");
                setDraft("");
              }}
            >
              <Icon name="rewrite" />
            </button>
            <button
              type="button"
              className={`dir-btn ${action === "fork" ? "on" : ""}`}
              title={forkBlock ?? "分岔：从这一轮开头开新分支，停下来等你发话"}
              disabled={forkBlock !== null}
              onClick={(e) => {
                e.stopPropagation();
                setAction(action === "fork" ? null : "fork");
                setDraft("");
              }}
            >
              <Icon name="fork" />
            </button>
            {voiceAvailable && voice !== "none" && (
              <button
                type="button"
                className={`dir-btn ${voice === "pending" ? "voice-pending" : ""}`}
                title={voice === "pending" ? "语音生成中" : "重听这句"}
                aria-label={voice === "pending" ? "语音生成中" : "重听这句"}
                disabled={voice === "pending"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (voice === "ready" && view?.seq !== null && view?.seq !== undefined) onReplay(view.seq);
                }}
              >
                <Icon name="volume" />
              </button>
            )}
            <button
              type="button"
              className={`dir-btn ${playback.auto ? "on" : ""}`}
              title={playback.auto ? "自动播放：开（点一下关）" : "自动播放：关（点一下开）"}
              aria-pressed={playback.auto}
              aria-label="自动播放"
              onClick={(e) => {
                e.stopPropagation();
                playback.setAuto(!playback.auto);
              }}
            >
              {playback.auto ? <Icon name="pause" /> : <Icon name="play" />}
            </button>
          </div>
        </div>

        {action && (
          <Modal
            title={ACTION_META[action].title}
            hint={ACTION_META[action].hint}
            onClose={() => setAction(null)}
            footer={
              <>
                <button
                  type="button"
                  className="primary"
                  onClick={submitAction}
                  disabled={
                    action === "edit"
                      ? draft.trim() === "" || !targets.lineNodeId
                      : action === "restart" || action === "fork"
                        ? !targets.beatId
                        : false
                  }
                >
                  {ACTION_META[action].submit(draft.trim())}
                </button>
                <button type="button" className="ghost-btn" onClick={() => setAction(null)}>
                  取消
                </button>
              </>
            }
          >
            <div className="director-input">
              {action === "prompt" && (
                <button
                  type="button"
                  className={`ooc-shortcut ${draft.startsWith(OOC_PREFIX) ? "on" : ""}`}
                  title="以 OOC 开头 = 跳出角色，直接给剧作家下指令（他会照办，但不会跳出戏来跟你对话）"
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
                placeholder={ACTION_META[action].placeholder}
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
  /** 这一条落在哪一轮（重来的锚点）；玩家自己发来的话没有轮，返 null。 */
  beatFor: (entry: TranscriptEntry) => string | null;
  onSeek: (key: string) => void;
  onReplay: (seq: number) => void;
  onEdit: (nodeId: string, text: string) => void;
  /** 重来：退到这一轮之前重演，会分出一条新线。 */
  onFork: (nodeId: string, opts?: { resume?: boolean }) => void;
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
                      onClick={() => beat && onFork(beat, { resume: true })}
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

/** 历史条目的呈现分工：正文一个样式，思考/原始 DSL 走等宽体（它们不是台词）。 */
const HISTORY_KIND: Record<HistoryEntry["role"], { label: string; cls: string }> = {
  user: { label: "注入上下文", cls: "hx-user" },
  thinking: { label: "剧作家思考", cls: "hx-thinking" },
  assistant: { label: "原始 DSL（未解析）", cls: "hx-dsl" },
  toolCall: { label: "工具调用", cls: "hx-tool" },
};

/**
 * 剧作家原始历史：活动周目最近若干轮的 session 快照（REST 只读，不建 runtime、不改状态）。
 * 与回顾互补——回顾只给解析后的台词与选肢，这里给写出来之前的原文：注入上下文、
 * 思考、未经解析的原始 DSL、工具调用。空表不是错误：还没落盘（读盘落后一轮）
 * 或纪元压缩前没有留存。标题条由外层 BacklogView 统一给，这里只出内容。
 */
export function HistoryView({ playId, nonce }: { playId: string; nonce: number }) {
  const [beats, setBeats] = useState<HistoryBeat[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .history(playId)
      .then((r) => alive && setBeats(r.beats))
      .catch(() => alive && setBeats([]));
    return () => {
      alive = false;
    };
  }, [playId, nonce]);

  if (beats === null) return <div className="overlay">读取历史…</div>;
  if (beats.length === 0) {
    return <p className="backlog-empty">还没有留存的历史——生成完就写进来了。</p>;
  }
  return (
    <div className="backlog-panel">
      {beats === null ? (
        <div className="overlay">读取历史…</div>
      ) : beats.length === 0 ? (
        <p className="backlog-empty">还没有留存的历史——生成完就写进来了。</p>
      ) : (
        <>
          {beats.map((beat) => (
            <section key={beat.turn} className="hx-beat">
              <header className="hx-beat-head">
                <span>第 {beat.turn} 次生成</span>
                <span className="muted">{beat.entries.length} 条</span>
              </header>
              {beat.entries.map((entry) => {
                const kind = HISTORY_KIND[entry.role];
                return (
                  <div key={`${entry.beat}-${entry.seq}`} className={`hx-entry ${kind.cls}`}>
                    <span className="hx-kind">
                      {kind.label}
                      {entry.role === "toolCall" && entry.name ? ` · ${entry.name}` : ""}
                    </span>
                    {entry.role === "toolCall" ? (
                      <pre className="hx-tool">{JSON.stringify(entry.args ?? {}, null, 2)}</pre>
                    ) : (
                      <p className="hx-text">{entry.text}</p>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          <p className="muted hx-foot">只读快照，落盘比当前轮慢一步——要最新的按侧栏的「刷新」。</p>
        </>
      )}
    </div>
  );
}
