/**
 * 剧内状态（`memory/always/state/*`）：三个文件的读取、播种与回写（P6-d）。
 *
 * 这三个文件是**工作态的唯一载体**：剧作家用通用 `write` / `edit` 维护它们，A 区【状态】区每轮现读。
 * **分支 / 存档真值在谱系快照里**——收束时把文件原文存进快照，跳转 / 分岔 / 读回旧轮 / 切换存档时
 * 用快照回写文件（设计稿 `261009-p6-d-update-state.design.md` §3）。
 *
 * 两条刻意的约定：
 *
 * - **原文存取**：快照里存的是三个文件的**逐字原文**，回写时不重序列化——模型写的格式（缩进、
 *   键顺序、它自己加的白注释性字段）在分支切换之后原样还在。
 * - **读取一律容错**：坏 JSON 只当没读到那两行（与插件同一套行为），由 readiness 的
 *   `stateProblem` 在 A 区把问题说出来（设计稿 §6），不在这里抛错。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 状态文件的体检（包内 readiness 那份，与 `validate_play` 同源）：转出来供 B 区【状态】区直接用，
 * 免得服务端自己再写一份判据。
 */
export { readStateProblem } from "@aivn/agent";

/** 剧内状态目录（剧目根相对路径）。 */
export const PLAY_STATE_DIR = "memory/always/state";

const SCENE_FILE = "scene.md";
const THREADS_FILE = "threads.md";
const STATE_FILE = "state.json";

/** 三个文件的原文（`state` 是 `state.json` 的原文，不是解析结果）。 */
export interface PlayStateText {
  scene: string;
  threads: string;
  state: string;
}

/** 旗标值的类型（与 `play.json` 的 `initialState.flags` 同一套：字符串 / 数字 / 布尔）。 */
export type PlayFlagValue = string | number | boolean;

/** 三个文件里引擎真正认的那两格（好感度 / 旗标）。 */
export interface PlayStateLive {
  affinity: Record<string, number>;
  flags: Record<string, PlayFlagValue>;
}

/** 这三个路径是不是剧内状态文件（写盘回调与还原逻辑按它分流）。 */
export function isPlayStatePath(rel: string): boolean {
  return (
    rel === `${PLAY_STATE_DIR}/${SCENE_FILE}` ||
    rel === `${PLAY_STATE_DIR}/${THREADS_FILE}` ||
    rel === `${PLAY_STATE_DIR}/${STATE_FILE}`
  );
}

/** 读三个文件（缺文件给空串；不解析、不校验）。 */
export function readPlayStateText(dir: string): PlayStateText {
  const root = join(dir, PLAY_STATE_DIR);
  return {
    scene: readText(join(root, SCENE_FILE)),
    threads: readText(join(root, THREADS_FILE)),
    state: readText(join(root, STATE_FILE)),
  };
}

/** 写三个文件（目录不存在就建；不碰别的文件）。 */
export function writePlayStateText(dir: string, text: PlayStateText): void {
  const root = join(dir, PLAY_STATE_DIR);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, SCENE_FILE), text.scene, "utf8");
  writeFileSync(join(root, THREADS_FILE), text.threads, "utf8");
  writeFileSync(join(root, STATE_FILE), text.state, "utf8");
}

/**
 * 新存档 / 周目起点：用 `play.json` 的初值落这三个文件。
 *
 * 服务端一个剧目可以有多份存档（`saves/<saveId>/`），而状态文件是剧目级的——所以新存档必须
 * **覆盖**这三个文件，否则新周目第一轮就会读到上一周目的残留（插件今天由引擎在周目边界做同一件事）。
 */
export function seedPlayState(
  dir: string,
  init: { scene: string; affinity: Record<string, number>; flags: Record<string, PlayFlagValue> },
): void {
  writePlayStateText(dir, {
    scene: `${init.scene}\n`,
    threads: "",
    state: `${JSON.stringify({ affinity: init.affinity, flags: init.flags }, null, 2)}\n`,
  });
}

/** 解析 `state.json`（容错：坏 JSON / 形状不对只当空的）。 */
export function parsePlayState(text: string): PlayStateLive {
  if (text.trim() === "") return { affinity: {}, flags: {} };
  let parsed: { affinity?: unknown; flags?: unknown };
  try {
    parsed = JSON.parse(text) as { affinity?: unknown; flags?: unknown };
  } catch {
    return { affinity: {}, flags: {} };
  }
  const affinity: Record<string, number> = {};
  if (parsed.affinity && typeof parsed.affinity === "object" && !Array.isArray(parsed.affinity)) {
    for (const [id, value] of Object.entries(parsed.affinity as Record<string, unknown>)) {
      if (typeof value === "number") affinity[id] = value;
    }
  }
  const flags: Record<string, PlayFlagValue> = {};
  if (parsed.flags && typeof parsed.flags === "object" && !Array.isArray(parsed.flags)) {
    for (const [key, value] of Object.entries(parsed.flags as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") flags[key] = value;
    }
  }
  return { affinity, flags };
}

/** `state.json` 的规范化原文（好感度 / 旗标两格；工具与迁移后的写口共用它）。 */
export function playStateJson(live: PlayStateLive): string {
  return `${JSON.stringify({ affinity: live.affinity, flags: live.flags }, null, 2)}\n`;
}

function readText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
