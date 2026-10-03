/**
 * 运行期设置的持有者：**唯一真相源是 `<dataRoot>/settings.json`**，内存里那份是它的镜像。
 *
 * 面板改一项就走 {@link patch}：校验 → 原子落盘 → 通知订阅者就地生效，
 * 全程不要求重启（过去的 `.env` 面改完必须重启，用户视角看就是「保存了没反应」）。
 *
 * `.env` 只在**第一次启动**参与：没有 `settings.json` 而环境里有旧配置时，按旧语义
 * 迁成一份 settings.json 再落盘；此后 `.env` 与运行期设置再无关系，只剩端口、
 * 监听地址、数据目录这类「装在哪、怎么起」的启动参数还认环境变量（见 `loadBootstrap`）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, join, basename } from "node:path";
import { applyPatch, freshSettings, settingsFromEnv, type ServerConfig, type SettingsPatch } from "./config.js";

/** 设置文件在数据目录里的固定位置。 */
export function settingsPath(dataRoot: string): string {
  return join(dataRoot, "settings.json");
}

/**
 * 「能读到当前设置」这件事的最小接口：只读的组件（音色库客户端等）依赖它，
 * 而不是依赖整个 store——它们不该有改设置的能力。
 */
export interface SettingsSource {
  get(): ServerConfig;
}

export class SettingsStore implements SettingsSource {
  private readonly listeners = new Set<(config: ServerConfig) => void>();
  /** 上一次由本进程写下的原文：手改监视据此区分「自己写的」与「别人写的」。 */
  private lastWritten = "";
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;

  /** 生产路径走 {@link open}；直接 `new` 只给测试用（不落盘、不监视）。 */
  constructor(
    private readonly file: string,
    private current: ServerConfig,
  ) {}

  /**
   * 打开数据目录的设置：有 `settings.json` 就用它，否则迁移或新装，并立刻落盘。
   *
   * 落盘的动作用处是「用户第一次打开 exe 就能看到这份文件」——想手改的人得先看到它长什么样。
   */
  static open(dataRoot: string, env: NodeJS.ProcessEnv): SettingsStore {
    const file = settingsPath(dataRoot);
    const raw = readIfExists(file);
    if (raw !== null) {
      const store = new SettingsStore(file, parseSettings(raw, file));
      store.lastWritten = raw;
      store.watchFile();
      return store;
    }
    const legacy = hasLegacySettings(env);
    const initial = legacy ? settingsFromEnv(env) : freshSettings();
    const store = new SettingsStore(file, initial);
    store.persist();
    console.log(
      legacy
        ? `[stage-ai] 已把 .env 里的设置迁移到 ${file}（此后 .env 不再参与运行期配置）`
        : `[stage-ai] 已生成默认设置 ${file}（网关、生图、语音都还没配，可在设置页填）`,
    );
    store.watchFile();
    return store;
  }

  /** 当前设置。调用方应**每次使用时取**，不要拷进字段——那正是「改完要重启」的来源。 */
  get(): ServerConfig {
    return this.current;
  }

  /** 应用补丁：校验不过整体抛错（不落半份配置）；无实际改动时既不落盘也不通知。 */
  patch(patch: SettingsPatch): string[] {
    const { next, changed } = applyPatch(this.current, patch);
    if (changed.length === 0) return changed;
    this.current = next;
    this.persist();
    this.notify();
    return changed;
  }

  /** 订阅设置变化（就地生效的挂点）。返回退订函数。 */
  subscribe(listener: (config: ServerConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 停掉手改监视（测试收尾用；进程退出时不需要）。 */
  close(): void {
    clearTimeout(this.reloadTimer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  /** 原子落盘：先写临时文件再改名，中途断电也不会留一份写坏的设置。0600 只给本机用户。 */
  private persist(): void {
    this.lastWritten = `${JSON.stringify(this.current, null, 2)}\n`;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.lastWritten, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.current);
      } catch (error) {
        console.warn(`[stage-ai] 设置变化处理失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** 手改监视：用户直接编辑 settings.json 也即时生效（忘了密码时删掉那一行即可解锁）。 */
  private watchFile(): void {
    try {
      // 监视**目录**而不是文件：落盘走的是「写临时文件再改名」，改名会把原来的 inode 换掉，
      // 盯着那个文件本身的 watcher 在第一次保存之后就再也收不到事件了。
      this.watcher = watch(dirname(this.file), (_event, name) => {
        if (name !== null && name !== basename(this.file)) return;
        // 去抖：一次保存往往连发两三个事件，写坏的中间态也会先到一次
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => this.reloadFromDisk(), 200);
      });
    } catch (error) {
      console.warn(
        `[stage-ai] 无法监视 ${this.file}（手改这个文件不会即时生效）: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private reloadFromDisk(): void {
    const raw = readIfExists(this.file);
    if (raw === null || raw === this.lastWritten) return;
    let parsed: ServerConfig;
    try {
      parsed = parseSettings(raw, this.file);
    } catch (error) {
      console.warn(
        `[stage-ai] settings.json 手改后读不动，已忽略这次改动: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    this.current = parsed;
    this.lastWritten = raw;
    console.log("[stage-ai] settings.json 已改动，就地生效");
    this.notify();
  }
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/**
 * 解析设置文件：整份当作一个补丁叠在新装默认值上——手写的文件可以只写关心的几项，
 * 每一项仍然过同一套校验（`applyPatch`），所以手改也不会写进一个上游读不懂的值。
 */
function parseSettings(raw: string, file: string): ServerConfig {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON（${error instanceof Error ? error.message : String(error)}）`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${file} 应当是一个 JSON 对象`);
  }
  const known = new Set(Object.keys(freshSettings()));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) console.warn(`[stage-ai] settings.json 里的 ${key} 不是已知设置项，已忽略`);
  }
  return applyPatch(freshSettings(), data as SettingsPatch).next;
}

/** 环境里有没有值得迁移的旧配置（只看玩得转的那几把 key，`STAGE_PORT` 这类属启动参数）。 */
function hasLegacySettings(env: NodeJS.ProcessEnv): boolean {
  return [
    "STAGE_MODEL_ID",
    "STAGE_MODEL_BASE",
    "STAGE_MODELS",
    "STAGE_BASE_URL",
    "STAGE_API_KEY",
    "STAGE_PASSWORD",
    "STAGE_IMAGE_BASE_URL",
    "STAGE_IMAGE_MODEL",
    "STAGE_IMAGE_API_KEY",
    "STAGE_TTS_KEYS",
    "STAGE_EXA_KEYS",
  ].some((key) => (env[key] ?? "").trim() !== "");
}
