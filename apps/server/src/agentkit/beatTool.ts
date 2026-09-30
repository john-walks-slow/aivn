import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { PlaywriterKitDeps } from "./deps.js";

/**
 * 轮收束工具（仅剧作家）：本轮写完时调用，**同时**交出这一轮的停止点。
 *
 * 停止点原来是 `<stop type> + <option>` 两个文本标签，代价是解析器要维护一套状态机
 * （stopped 闸门 + 提示词里「stop 之后别再说话」的约束双兜底）。搬进参数后：
 * - 工具 terminate 之后没有文本位置可写，那条提示词约束整段消失；
 * - `options` 的 minItems=2 由 pi 的参数校验兜住——只写一个选项会拿到校验错误回执并重试，
 *   编排器那条「choice 无选项降级 free」的护栏随之删除。
 */
const beatDoneParams = Type.Object(
  {
    /** 给 2~4 个选项 = 这一轮停在选项面板（player 选一条继续）。只给一个选项会被校验拒绝。 */
    options: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 4 }),
    ),
    /** 只给 placeholder（不给 options）= 停在自由输入框，placeholder 是输入框提示语。 */
    placeholder: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);

const BEAT_DONE_DESCRIPTION = [
  "本轮演出内容写完时调用，**不与其他工具同批调用**。",
  "本轮停在哪里由参数决定：",
  "- options（2~4 条）= 停在选项面板，玩家点一条继续；",
  "- 只给 placeholder = 停在自由输入框，placeholder 是提示语；",
  "- 两个都不给 = 本轮自然演完，玩家点「继续」接下一轮。",
  "选项要在「主角必须表态/行动」的那一刻给，只是往前推剧情时两个参数都不给。",
].join("\n");

export function createBeatDoneTool(deps: Pick<PlaywriterKitDeps, "emitStop">): AgentTool<typeof beatDoneParams> {
  return {
    name: "beat_done",
    label: "结束本轮",
    description: BEAT_DONE_DESCRIPTION,
    parameters: beatDoneParams,
    execute: async (_toolCallId, params: Static<typeof beatDoneParams>) => {
      const options = (params.options ?? []).map((text) => ({ text: text.trim() })).filter((o) => o.text !== "");
      const placeholder = params.placeholder?.trim();
      // options 与 placeholder 同时给是有歧义的（选项面板和自由输入框二选一）。按 options 走，
      // 但回执里说明 placeholder 这轮不生效——不静默丢掉模型写下的东西。
      const hasBoth = (params.options ?? []).length > 0 && Boolean(placeholder);
      // minItems 拦得住「只给一个」，拦不住 ["  ", "x"]：schema 里每个元素 minLength=1 照样过，
      // 去掉空白后不足两条。静默当成「自然演完」会把模型的一次笔误变成一次没有停止点的轮。
      if ((params.options ?? []).length > 0 && options.length < 2) {
        throw new Error("options 至少要有两条非空文本（整条只有空白不算）；或者只给 placeholder = 停在自由输入框");
      }
      // 载荷直接 emit 成 stop IR 事件：进事件缓冲 + 落谱系，与解析器产出的事件完全同构
      const hasOptions = options.length >= 2;
      if (hasOptions) deps.emitStop({ stopType: "choice", options });
      else if (placeholder) deps.emitStop({ stopType: "free", placeholder });
      return {
        content: [
          {
            type: "text" as const,
            text: hasOptions
              ? hasBoth
                ? "已交出选项停止点（本轮同时给了 placeholder，按 options 走，placeholder 这轮不生效）。本轮到此结束。"
                : "已交出停止点，本轮到此结束。"
              : placeholder
                ? "已交出停止点，本轮到此结束。"
                : "本轮到此结束。",
          },
        ],
        details: undefined,
        // 收束 turn：工具之后没有文本位置可写，「stop 之后别再说话」那条提示词约束随之消失。
        // 批内还有别的工具时 pi 不会收束（shouldTerminateToolBatch 要求**全部**结果都 terminate），
        // 由编排器的 finishTurn 兜底——工具这一侧只负责声明自己的语义。
        terminate: true,
      };
    },
  };
}

/** beat_done 之前需要 describe 时给纪元压缩用：把参数渲染成一句人话。 */
export function renderBeatDone(args: unknown): string {
  const params = args as Static<typeof beatDoneParams> | undefined;
  const options = params?.options ?? [];
  if (options.length >= 2) return `[交给玩家选择：${options.join(" / ")}]`;
  if (params?.placeholder) return `[交给玩家自由输入]`;
  return "[本轮自然演完，没有停止点]";
}
