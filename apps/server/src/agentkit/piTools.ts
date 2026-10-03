import {
  BACKGROUND_CONTEXT,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  withAbortSignal,
  type AgentHarnessTool,
  type AgentHarnessToolInvocation,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { PlayEnv } from "./playEnv.js";

/**
 * pi 的内建工具（read / write / edit / bash）与裸 `Agent` 之间的适配层。
 *
 * pi 把它们定义成 `AgentHarnessTool`：`execute` 比 `AgentTool` 多三个参数——`onUpdate` 挪到第三个、
 * 然后 `toolContext`、`invocation`、`context`。我们跑的是裸 `Agent`（没有 harness 的 session/lane），
 * 所以这里把多出来的三个补上：
 *
 * - `toolContext`：这四个工具的 `ExecutionToolContext` 只要一个 `{ env }`；
 * - `context`：`BACKGROUND_CONTEXT` 外面套调用方给的 abort signal——工坊单轮 7 分钟的超时靠它传下去，
 *   到点 `NodeExecutionEnv` 会杀掉子进程，否则一条死循环命令能把面板永久锁住；
 * - `invocation`：四个工具一个都不读它（`getMemo`/`setMemo` 是给可重放的 harness 工具用的）。
 *
 * 描述直接用 pi 的（英文）。它们没有覆写入口，而「不 fork pi 工具」正是这一轮的目的；
 * 设置页显示的仍是 `TOOL_CATALOG` 里的中文标签，模型侧中英混排无碍。
 */
function adapt(tool: AgentHarnessTool<any>, env: PlayEnv): AgentTool<any> {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(
        toolCallId,
        params,
        onUpdate ?? (() => {}),
        { env },
        NO_INVOCATION,
        signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT,
      ),
  };
}

/** 占位 invocation：四个内建工具都不读它，给一个取不到东西的空壳即可。 */
const NO_INVOCATION: AgentHarnessToolInvocation = {
  invocationId: "",
  operationId: "",
  turnId: "",
  getMemo: async () => undefined,
  setMemo: async () => {},
};

/** read / write / edit：三个结构化文件工具，路径都从 `PlayEnv.absolutePath` 过白名单。 */
export function createPiFileTools(env: PlayEnv): AgentTool<any>[] {
  return [adapt(createReadTool(), env), adapt(createWriteTool(), env), adapt(createEditTool(), env)];
}

/** bash：跑在剧目目录（`env.cwd`）下。它不经过白名单——见 `playEnv.ts` 的说明。 */
export function createPiBashTool(env: PlayEnv): AgentTool<any> {
  return adapt(createBashTool(), env);
}
