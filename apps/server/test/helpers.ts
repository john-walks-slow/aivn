import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { PlayConfig } from "@aivn/core";
import type { AgentCapabilities } from "../src/agentkit/kit.js";
import type { IndexCard } from "../src/memory.js";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/config.js";
import type { ImageBackend, ImageBackends, ImageKind, ImageReference } from "../src/imageBackend.js";
import { SettingsStore } from "../src/settingsStore.js";

/**
 * 三类共用一只桩后端：只关心一条出图链路的用例用它；
 * 要验类目路由的用例自己给一整组（见 `playAssets.test.ts`）。
 */
export function sharedBackends(backend: ImageBackend): ImageBackends {
  return { background: backend, cg: backend, sprite: backend };
}

/** 三类都走 neutral 垫图（PlayHouse 的缺省策略同此）。 */
export const NEUTRAL_REFERENCE: Record<ImageKind, ImageReference> = {
  background: "neutral",
  cg: "neutral",
  sprite: "neutral",
};

/**
 * 测试用的设置源：只带一份配置，不落盘也不起监视。
 *
 * 依赖设置的模块（PlayHouse / 音色库 / 密码闸门）要的是「随时能读到当前设置」这件事本身，
 * 测试里给它一份固定值就够了；真要验证落盘与迁移的用例去 `settingsStore.test.ts`。
 */
export function settingsStoreFor(config: ServerConfig): SettingsStore {
  return new SettingsStore(join(tmpdir(), `stage-settings-unused-${randomUUID()}.json`), config);
}

export interface FakeResponse {
  /** 剧本 DSL 原文（流式输出的 assistant 文本）。 */
  text: string;
  /** 剧作家的思考文本（assistant 消息里的 thinking 块）。 */
  thinking?: string;
  /**
   * 附带 beat_done 工具调用。true = 本轮自然演完（不带停止点载荷）；
   * 给对象就是交出停止点（选项/自由输入），与模型真调工具时的参数同形。
   */
  beatDone?: boolean | { options?: string[]; placeholder?: string };
  /** 额外工具调用（与 beat_done 同批：如 search_archive / write）。 */
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  /** 闸门：正文照发，但 done 押后到 gate 兑现——用来把某一轮卡在「演出中」。 */
  gate?: Promise<unknown>;
  /** 回填给 provider 的 input token 数（默认 0 = 不回填，标定系数按 1 算）。 */
  usageTokens?: number;
}
export const PLAY: PlayConfig = {
  id: "test",
  title: "测试剧目",
  premise: "测试 premise",
  // 角色配置在角色卡上，play.json 的 characters 是纯元数据——这里不给也不影响任何运行时行为

  opening: "（游戏开始）",
  initialState: { turn: 0, affinity: { mio: 10 }, flags: {} },
  initialScene: "走廊",
};

/**
 * 能力位（`kit.can`）的测试构造器。
 *
 * 两份 system prompt 读的是同一个形状，测试里也共用这一份——加一位能力时这里必然类型不过，
 * 两个角色的提示词都得跟着看一眼。缺省取剧作家的常见态：记忆与「管理角色」开、限制级开、
 * 联网与资源库关（没配 key 时的样子），工坊侧的几位一律 false。
 */
export function caps(over: Partial<AgentCapabilities> = {}): AgentCapabilities {
  return {
    stage: true,
    nsfw: true,
    characters: true,
    memory: true,
    image: true,
    library: false,
    search: false,
    voice: false,
    files: false,
    skill: false,
    view: false,
    readiness: false,
    shell: false,
    ...over,
  };
}

export const CARD: IndexCard = {
  layer: "lore",
  name: "旧约定",
  summary: "两人初中时的约定。",
  detail: "# 旧约定\n初中时澪和主角约好一起参加文化祭。\n",
  file: "旧约定",
};

/**
 * 第一轮的剧本正文。停止点不在这里——夹具按 `beatDone` 字段把它渲染成末行的停止点标签
 * （P6-e 起两个宿主都是这条；旧写法的 `<option>` 子标签仍是遗留标签、静默丢弃）。
 */
export const BEAT_1 = [
  '<scene bg="corridor_dusk" bgm="melancholy" transition="fade"/>',
  '<actor id="mio" pos="center" expression="pout" action="enter"/>',
  "<narrate>放学后的走廊空无一人。</narrate>",
  '<say id="mio">……太慢了！</say>',
].join("\n");

/** 第一轮的停止点载荷（选项两条），与 BEAT_1 配套。 */
export const BEAT_1_STOP = { options: ["道歉", "装傻"] };

export const BEAT_2 = [
  '<say id="mio">……算了。</say>',
  "<narrate>风停了。</narrate>",
].join("\n");

/** 假 LLM 流：按调用序号回放脚本，完整模拟 text 流 + tool_call + done。 */
/**
 * 把夹具里的 `beatDone` 渲染成剧本末行的停止点标签（P6-e）。
 *
 * 选项之间用 `|` 分隔、两端空白由解析器去掉——与真实写法一致。
 */
function stopTag(beatDone: true | { options?: string[]; placeholder?: string }): string {
  if (beatDone === true) return "<stop/>";
  if (beatDone.options) return `<stop options="${beatDone.options.join(" | ")}"/>`;
  if (beatDone.placeholder) return `<stop placeholder="${beatDone.placeholder}"/>`;
  return "<stop/>";
}

export function createFakeStreamFn(responses: FakeResponse[]): StreamFn {
  let call = 0;
  // 一条响应同时带「收束」和工具调用时，真跑里 pi 拿到工具结果还会再问模型一次——
  // 那一跳由夹具自动补一条空收尾（不占响应数组的下标），语义就是「模型写完、调了工具、停笔」。
  let autoClose = false;
  return () => {
    if (autoClose) {
      autoClose = false;
      return createFakeStreamFn([{ text: "" }])({} as never, {} as never, {} as never);
    }
    // 假流在响应数组用完之后**重放最后一条**。P6-e 之前 beat_done 的 terminate 一直在替
    // 「最后一条带工具调用」的用例兜底收束；现在轮边界是「模型不再调工具」，重放会变成死循环。
    // 这里给一个上限，把死循环变成一条看得见的失败（真跑不会这样：模型会停）。
    if (call > 60) throw new Error("假流调用超过 60 次：最后一条响应带工具调用且被反复重放，这一轮收不了");
    const response = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    // P6-e：停止点是剧本末行的标签（不是工具调用）。夹具照真实形态渲染，
    // 用例仍然只表达「这一轮的出口是什么」——标签是 void 标签，不产生台词，零台词轮的语义不变。
    const text = response.beatDone ? `${response.text}\n${stopTag(response.beatDone)}` : response.text;
    if (response.beatDone && (response.toolCalls?.length ?? 0) > 0) autoClose = true;
    const stream = createAssistantMessageEventStream();
    const partial = { role: "assistant", content: [] } as AssistantMessage;

    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      if (response.thinking) {
        // 思考块在 content 数组里排在正文之前，事件序与之一致（先 thinking_* 后 text_*）
        stream.push({ type: "thinking_start", contentIndex: 0, partial });
        stream.push({ type: "thinking_delta", contentIndex: 0, delta: response.thinking, partial });
        stream.push({ type: "thinking_end", contentIndex: 0, content: response.thinking, partial });
      }
      const textIndex = response.thinking ? 1 : 0;
      stream.push({ type: "text_start", contentIndex: textIndex, partial });
      for (const delta of text.match(/[\s\S]{1,7}/g) ?? []) {
        stream.push({ type: "text_delta", contentIndex: textIndex, delta, partial });
      }
      stream.push({
        type: "text_end",
        contentIndex: textIndex,
        content: text,
        partial,
      });

      if (response.gate) {
        void response.gate.then(() => finish());
      } else {
        finish();
      }

      function finish(): void {
        const finalMessage: AssistantMessage = {
          role: "assistant",
          content: [
            ...(response.thinking
              ? ([{ type: "thinking", thinking: response.thinking }] as AssistantMessage["content"])
              : []),
            { type: "text", text },
          ],
          api: "openai-completions",
          provider: "fake",
          model: "fake-test",
          // usage 全零：假流不知道真实上下文大小，交回 pi 的字符启发式（纪元压缩按它判定阈值）。
          // 给了 usageTokens 就按它回填 input —— token 标定系数（工坊线程压缩）测的就是这条路径。
          usage: {
            input: response.usageTokens ?? 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: response.usageTokens ?? 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        let callNo = 2;
        for (const tool of response.toolCalls ?? []) {
          finalMessage.content.push({
            type: "toolCall",
            id: `call-${callNo++}`,
            name: tool.name,
            arguments: tool.args,
          });
          finalMessage.stopReason = "toolUse";
        }
        stream.push({ type: "done", message: finalMessage });
        stream.end(finalMessage);
      }
    });
    return stream;
  };
}
