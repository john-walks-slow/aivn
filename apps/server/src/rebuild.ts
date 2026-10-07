import {
  lineageToEvents as coreLineageToEvents,
  stopFromNode,
  toNodeView,
} from "@aivn/core";
import type { CompactionRecord, LineageEvent, SequencedEvent, StopPayload } from "@aivn/core";

/**
 * 上下文重建（P6 transformContext 的纯函数层）：谱系事件日志是唯一真相源，
 * 分岔/跳转/编辑之后从日志重放出「客户端事件流」与「LLM 对话轮次」，
 * 完成一次突变后即回到 append-only 稳态。
 *
 * 入参一律是 `LineageTree.materialize()` 的产物：edit 覆盖已生效、fork 标记已剔除。
 */

/**
 * 谱系事件链 → 客户端 IR 事件。
 *
 * 物化本身在 core（路线树与回看共用同一份函数），这里只做投影适配：服务端手里是
 * LineageEvent，core 的重放吃的是路线树投影，规则只有一份。
 * edit 的覆盖不在这里补——`materialize()` 已经把改写后的文本填回 text 了。
 */
export function lineageToEvents(chain: readonly LineageEvent[]): SequencedEvent[] {
  return coreLineageToEvents(chain.map(toNodeView));
}

export function stopFromEvent(event: LineageEvent): StopPayload | null {
  return stopFromNode(toNodeView(event));
}

/** 一轮的重建素材：玩家输入（可空 = 开场）与已演出脚本。 */
export interface RebuiltBeat {
  user: string;
  assistant: string;
  /**
   * 这一拍之前最近的那个 `beat_end`；分支的第一拍为 null。
   *
   * 纪元压缩按它记切点（切点之前的原文才会被摘要替换），所以它必须是链上的边界节点，
   * 而不是拍内任意节点——否则投影出来的对话体与「重放出来的原文」对不上。
   */
  boundaryId: string | null;
}

/** 重建对话轮次时的读者身份。 */
export interface RebuildMode {
  /** 此刻是否在限制级通道里。false/缺省 = SFW 侧读者，露骨原文一律不进消息。 */
  nsfw?: boolean;
  /**
   * 这条分支的纪元压缩记录：切点之前的原文一律由摘要代表。
   *
   * 记录只对写它的那条路径生效——切点不在链上（跳到了别的分支）就当没有过压缩。
   * 压缩因此不需要任何撤销逻辑：跳转/分岔/编辑/读档走的都是这一条投影。
   */
  compaction?: CompactionRecord;
}

/** 一轮的文本：还没接到链上，所以还没有边界 id。 */
type BeatText = Omit<RebuiltBeat, "boundaryId">;

/**
 * 限制级段落 → 日常的过渡轮。
 *
 * 一段限制级内容对 SFW 侧只留下这一句摘要，所以过渡轮的措辞在这里定死一份：
 * 实时退出（`orchestrator.switchBackToSfw`）与从谱系重建（`lineageToBeats` 的折叠）
 * 共用它——两处各写一套必然漂移，而漂移的表现是「退出前后模型看到的上下文不一样」。
 */
export function nsfwTransitionBeat(summary: string): BeatText {
  return {
    user: [
      "【前情提要·日常接续】（上一幕两人之间展开了亲密温存的互动，全年龄概要如下：）",
      summary,
      "（限制级情节已完结，请恢复常规日常基调，根据当前世界状态继续创作后续剧情。）",
    ].join("\n"),
    assistant: "已了解。我们将顺着这一进展恢复日常基调，继续后续演出。",
  };
}

/**
 * 纪元压缩的前情提要：切点之前的原文全部由它代表。
 *
 * 措辞要点明「已经演过」——说成正在发生的事，模型会把摘要当成新剧情再演一遍。
 */
function compactionSeedBeat(summary: string): BeatText {
  return {
    user: [
      "【前情提要】（更早的剧情已压缩归档，以下都是已经发生的既定事实：）",
      summary,
      "（请直接从当前场景继续往后写，不要重演、不要推翻已确立的情节。）",
    ].join("\n"),
    assistant: "已了解。我会接着既定事实继续演出。",
  };
}

/**
 * 谱系链 → LLM 对话轮次。
 *
 * 轮边界 = 上一个 beat_end 之后的第一个事件；末尾未收束的半轮（轮中节点分岔）也成轮。
 * 玩家输入段照搬玩家原话（不在重建时替模型润色），【状态】不进历史轮次——
 * 状态由下一次生成时的 user 消息携带，避免 anachronistic 的旧状态快照。
 *
 * 链尾若是「有输入没台词」的一组（分岔落在一次表态上），它不能成轮：`{user, assistant:""}`
 * 这种空回复轮次在 Anthropic 一族的接口上直接 400。这类输入原样退回给编排器，
 * 由下一轮生成时并进 user 消息——玩家那句话因此不会丢，也不需要造假轮次。
 *
 * **限制级段落按读者折叠**：段内每一轮都带 `payload.nsfw`，段末那一拍的 `beat_end`
 * 带 `nsfwSummary`。SFW 侧读者（默认）把整段压成一条过渡轮，原文台词与段内玩家输入
 * 都不进消息；NSFW 侧读者原文照渲、摘要不用（同一段不出两份）。没有标记的老档不受影响。
 *
 * **纪元压缩也是同一件事**：`mode.compaction` 的切点之后才是这条分支的对话体，
 * 切点之前的原文折成一条前情提要（并进保留段首条 user）。压缩因此不是一次「就地突变」，
 * 而是重放的一个投影——跳转/分岔/编辑/冷启动读到的都是同一个结果。
 */
export function lineageToBeats(
  chain: readonly LineageEvent[],
  names: Readonly<Record<string, string>>,
  opening: string,
  mode: RebuildMode = {},
): { beats: RebuiltBeat[]; trailingInputs: string[] } {
  const raw = mode.nsfw === true;
  // 切点不在链上（记录是别的分支写的）= 这条路径没压过，照渲原文
  const record = mode.compaction;
  const cutAt = record ? chain.findIndex((event) => event.id === record.cutNodeId) : -1;
  const cut = cutAt >= 0 ? record : undefined;
  const events = cut ? chain.slice(cutAt + 1) : chain;
  const text = (event: LineageEvent): string => event.text ?? "";
  const beats: RebuiltBeat[] = [];
  let inputs: string[] = [];
  let script: string[] = [];
  // 保留段第一拍的前驱边界恒为切点自身（切点在投影之外，但它确实是链上的那个 beat_end）
  let boundaryId: string | null = cut?.cutNodeId ?? null;
  const flush = (): void => {
    if (script.length === 0) return;
    beats.push({
      user:
        inputs.length > 0
          ? inputs.map((text) => `【用户输入】\n${text}`).join("\n\n")
          : "【开场】\n" + opening,
      assistant: script.join("\n"),
      boundaryId,
    });
    inputs = [];
    script = [];
  };
  for (const event of events) {
    // SFW 侧读者在限制级段里：一个字都不渲，只在段末那一拍换出摘要
    if (!raw && event.payload?.nsfw === true) {
      const summary = event.payload?.nsfwSummary;
      if (typeof summary === "string" && summary.trim() !== "") {
        // 段内不 flush，累积器此刻是空的（上一拍的 beat_end 已经结清）；
        // 这一条直接落，不经过 flush——它的 user 侧是前情提要，不是段内那句被隐去的输入
        beats.push({ ...nsfwTransitionBeat(summary), boundaryId });
        // 折叠段的边界是段末那一拍：不推到它上面的话，后续拍的切点会落回段前，
        // 而按那个切点切片会把整段（连同摘要事件）切掉——过渡轮凭空消失
        boundaryId = event.id;
      }
      continue;
    }
    const attrs = event.payload?.attrs ?? {};
    switch (event.kind) {
      case "prompt":
        // 只收原文，标签由两处消费者各自补：成拍的 user 侧（flush）与链尾悬空那一批
        // （orchestrator.renderPromptTurn）。在这儿先拼一遍，链尾那批就会套两层【用户输入】。
        inputs.push(event.payload?.input ?? "");
        break;
      case "say": {
        const who = names[attrs.id ?? ""] ?? attrs.id ?? "";
        const mood = attrs.mood ? `（${attrs.mood}）` : "";
        script.push(`${who}${mood}：${text(event)}`);
        break;
      }
      case "thought":
        script.push(`${names[attrs.id ?? ""] ?? attrs.id ?? ""}（心声）：${text(event)}`);
        break;
      case "narrate":
        script.push(`（旁白）${text(event)}`);
        break;
      case "title":
        // 全屏标题卡也写回助手脚本体：剧作家后续轮次得知道自己写过这张卡（章节标题/诗歌）。
        script.push(`（标题）${text(event)}`);
        break;
      case "scene":
        script.push(
          `（场景：${attrs.bg ?? "未定"}${attrs.bgm ? ` · ♪ ${attrs.bgm}` : ""}${
            attrs.ambient ? ` · ${attrs.ambient}` : ""
          }）`,
        );
        break;
      case "actor":
        script.push(
          `（${names[attrs.id ?? ""] ?? attrs.id ?? ""} 就位${
            attrs.pos ? ` · ${attrs.pos}` : ""
          }${attrs.variant ? ` · ${attrs.variant}` : ""}${attrs.action ? ` · ${attrs.action}` : ""}）`,
        );
        break;
      case "cg":
        script.push(`（CG：${attrs.id ?? ""}${attrs.caption ? ` ${attrs.caption}` : ""}）`);
        break;
      case "sfx":
        script.push(`（音效：${attrs.src ?? ""}）`);
        break;
      case "stop": {
        const stop = stopFromEvent(event);
        if (stop) script.push(stopLine(stop));
        break;
      }
      case "beat_end":
        flush();
        boundaryId = event.id;
        break;
      default:
        break;
    }
  }
  flush();
  if (cut && cut.summary.trim() !== "") {
    const seed = compactionSeedBeat(cut.summary.trim());
    const first = beats[0];
    // 并进保留段首条 user：相邻两条同角色消息在部分 OpenAI 兼容网关上会被拒。
    // 整段都被切没了（切点就在链尾之后）时它自己成一条——否则这一条分支一个字都不剩。
    if (first) first.user = `${seed.user}\n\n${first.user}`;
    else beats.push({ ...seed, boundaryId: cut.cutNodeId });
  }
  return { beats, trailingInputs: inputs };
}

function stopLine(stop: StopPayload): string {
  if (stop.stopType === "choice") {
    const labels = (stop.options ?? []).map((option) => option.text).join(" / ");
    return `（等待玩家选择：${labels || "（无选项）"}）`;
  }
  return "（等待玩家自由回应）";
}

