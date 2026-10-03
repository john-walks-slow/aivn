import type { AssetKind } from "@stage-ai/core";
import type { AssetLibrary } from "./library.js";
import { importFromLibrary, type ImportResult } from "./assetImport.js";
import { PlayMemory } from "./memory.js";
import type { PlayStore } from "./store.js";

/**
 * 引用即导入：剧本里写了一个 id，剧目里没有，宿主就去素材资源库里找同名条目并导入。
 *
 * 这里没有「导入」这个动作，也没有对应的工具——agent 只需要在 DSL 里写它想用的 id。
 * 拆开的好处是导入不必发生在 agent 的回合里：解析管道不 await，模型不为一趟文件复制
 * 多烧一轮预算，也不会在拍进行中拿到「我已导入」这种半吊子的回执。
 *
 * 找不到就什么都不做（舞台按现有逻辑降级）。**不回话给模型**——事件已经广播出去了，
 * 再插一句只会变成台词，或者打断正在写的那一轮。库里没有这个背景不是模型写错，
 * 是素材真的不存在，用户该在素材页看到的是缺图，不是模型的自我检讨。
 */
export interface AssetRef {
  /** DSL 属性 → 库里先查哪个类别（按顺序，第一个命中就算）。 */
  candidates: readonly AssetKind[];
  /** DSL 属性名（`<scene bg>` / `<cg id>` / `<actor id>` / `<sfx src>` / `<scene bgm>`）。 */
  attr: string;
  id: string;
}

export interface AssetRefResolverDeps {
  playId: string;
  store: PlayStore;
  library: AssetLibrary;
  /** 剧目当前的角色表：actor 引用先看这里，没有再问库。 */
  characters: () => Promise<readonly string[]>;
  /**
   * 导入完成：宿主广播，客户端把新素材并进索引。
   * 角色导入还会写角色卡，宿主要把重建排到轮边界——由它自己决定。
   * 传的是 `ImportResult` 而不是 (kind, id)：落盘文件名由库条目决定（有扩展名），
   * 宿主要拿真实路径去拼 URL，猜一个 `/assets/<kind>/<id>` 是拼不出来的。
   */
  onImported: (result: ImportResult) => void;
  warn: (message: string) => void;
}

export class AssetRefResolver {
  /** 本次运行已经处理过的 `kind/id`：事件重放与分岔回看会重复报同一个 id。 */
  private readonly done = new Set<string>();
  /** 同一个目标的并发导入合并成一次。 */
  private readonly inflight = new Map<string, Promise<void>>();
  /** 剧目里已有的素材（目录扫描一次，够这张表的大小）。 */
  private known: Set<string> | null = null;
  /** 角色表缓存：一次对话里几十个 actor 引用，逐个重读角色卡目录没有意义。 */
  private cast: Set<string> | null = null;

  constructor(private readonly deps: AssetRefResolverDeps) {}

  /**
   * 见到一批引用就异步补齐，不 await。
   *
   * 事件先广播、导入后到货：客户端在图到之前按「缺素材」降级（背景保持上一张、CG 不显示），
   * 这与今天「骨架占位」的表现同构，落地后一条 `asset_ready` 让它淡入。
   */
  resolve(refs: readonly AssetRef[]): void {
    for (const ref of refs) void this.resolveOne(ref);
  }

  private async resolveOne(ref: AssetRef): Promise<void> {
    const id = ref.id.trim();
    if (!id || isStopToken(id)) return;
    if (ref.candidates.includes("characters") && (await this.haveLocally("characters", id))) return;
    for (const kind of ref.candidates) {
      if (this.done.has(`${kind}/${id}`)) return;
      const key = `${kind}/${id}`;
      const running = this.inflight.get(key);
      if (running) {
        await running;
        return;
      }
      if (await this.haveLocally(kind, id)) {
        this.done.add(key);
        return;
      }
      const task = this.importFrom(kind, id, ref.attr);
      this.inflight.set(key, task);
      await task;
      return;
    }
  }

  private async importFrom(kind: AssetKind, id: string, attr: string): Promise<void> {
    const key = `${kind}/${id}`;
    try {
      // 库里没有就当这个 id 是模型自己起的名字：不是错，缺的图它自己会用 generate_image 出
      if (!(await this.deps.library.entry(kind, id))) {
        this.done.add(key);
        return;
      }
      const result = await importFromLibrary(this.deps.library, this.deps.store, { kind, entryId: id });
      this.done.add(key);
      await this.invalidate();
      this.deps.onImported(result);
    } catch (error) {
      this.done.add(key); // 失败不重试：同一轮里再报一次也只是再失败一次
      this.deps.warn(
        `自动导入 ${kind}/${id}（${attr} 引用）失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inflight.delete(key);
    }
  }

  /** 剧目里已经有的素材：背景/CG 查目录，音频同理，角色查角色卡目录。 */
  private async haveLocally(kind: AssetKind, id: string): Promise<boolean> {
    if (kind === "characters") {
      if (!this.cast) this.cast = new Set(await this.deps.characters());
      return this.cast.has(id);
    }
    if (!this.known) this.known = await this.scanAssets();
    return this.known.has(`${kind}/${id}`);
  }

  private async scanAssets(): Promise<Set<string>> {
    const found = new Set<string>();
    try {
      const assets = await this.deps.store.listAssets();
      const dirs: [AssetKind, string][] = [
        ["backgrounds", "backgrounds"],
        ["cg", "cg"],
        ["bgm", "bgm"],
        ["sfx", "sfx"],
      ];
      for (const [kind, dir] of dirs) {
        for (const file of assets[dir] ?? []) found.add(`${kind}/${file.replace(/\.\w+$/, "")}`);
      }
    } catch {
      // 扫不动就当什么都没有：多导一次只是覆盖同名文件，不会出错
    }
    return found;
  }

  private async invalidate(): Promise<void> {
    this.known = null;
    this.cast = null;
  }
}

/** 音频属性里的停止约定：`none` / 空串 / 大写 NONE 都是「停」，不是素材 id。 */
function isStopToken(id: string): boolean {
  const upper = id.toUpperCase();
  return id === "" || upper === "NONE";
}

/** 事件里的素材引用清单：属性名 → 库里按序尝试的类别。 */
export function refsFromScene(attrs: { bg?: string; bgm?: string; ambient?: string }): AssetRef[] {
  const refs: AssetRef[] = [];
  if (attrs.bg) refs.push({ attr: "bg", id: attrs.bg, candidates: ["backgrounds"] });
  if (attrs.bgm) refs.push({ attr: "bgm", id: attrs.bgm, candidates: ["bgm"] });
  // 环境音既可能是音效也可能是循环音乐：库里两个类别都查，先命中哪个算哪个
  if (attrs.ambient) refs.push({ attr: "ambient", id: attrs.ambient, candidates: ["sfx", "bgm"] });
  return refs;
}

export function refFromCg(id: string): AssetRef {
  return { attr: "cg id", id, candidates: ["cg"] };
}

export function refFromActor(id: string): AssetRef {
  return { attr: "actor id", id, candidates: ["characters"] };
}

export function refFromSfx(src: string): AssetRef {
  return { attr: "sfx src", id: src, candidates: ["sfx"] };
}

/**
 * 剧目里已注册的角色 id（`memory/always/characters/*.md` 的文件名主体）——角色表就是那个目录。
 * 主角不在表里：它没有 id，`<actor>` 引不到它。
 */
export async function characterIdsOf(store: PlayStore): Promise<string[]> {
  return [...(await PlayMemory.load(store)).characters.keys()];
}
