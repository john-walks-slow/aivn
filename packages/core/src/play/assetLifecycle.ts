/**
 * 素材生命周期契约：一份图 / 一首曲子从「在生成」到「进了素材表」经过哪些状态。
 *
 * 两条发行线（独立版与 DSH 插件）各有各的队列、存储和到货方式，但**状态名必须是同一套**：
 * 同一个「出好了、还没入库的候选」在两边叫不同名字，提示词与工具回执就没法共用一句话，
 * 用户看到的两套说法也没法对照。这里只定义领域语义，不规定谁去跑、跑多久、存在哪。
 *
 * 有意**没有 `rejected`**：没被挑中的候选不是被谁否决的，它只是没人采用，静静躺在草稿区
 * 直到过期清理（见独立版 `PlayAssets.pruneDrafts`）。把它记成一个状态等于让每个候选都欠
 * 一次显式否决，而用户「不选」这个动作在界面上根本不存在。
 */

/**
 * 一份素材的状态。
 *
 * - `pending`：已经受理、还在生成。独立版的剧作家后台排产停在它上面（面板上看得见），
 *   工坊的同步出图不经过它。
 * - `draft`：产物已在草稿区，**还不是剧目素材**——没写 `assets/`、没进素材表、没记台账。
 * - `adopted`：已入库，是剧目素材了。这是唯一的「可以被剧本引用」的状态。
 * - `expired`：草稿过了保留期被清理。它不是失败——图当时出得好好的，只是没人采用。
 * - `failed`：生成没成（后端报错、校验不过、草稿不存在）。**错因必须留住**，不许悄悄消失。
 */
export const ASSET_LIFECYCLE_STATES = ["pending", "draft", "adopted", "expired", "failed"] as const;

export type AssetLifecycleState = (typeof ASSET_LIFECYCLE_STATES)[number];

/** 终态：到了就不会再变。`draft` 不是终态——它在等采用，或者在等过期。 */
export const ASSET_LIFECYCLE_TERMINAL: ReadonlySet<AssetLifecycleState> = new Set([
  "adopted",
  "expired",
  "failed",
]);

export interface AssetLifecycleTransition {
  /** 起点；`null` 表示「此前没有这份素材」。 */
  from: AssetLifecycleState | null;
  to: AssetLifecycleState;
  /** 触发它的事由（宿主各自的实现细节，但语义要对得上）。 */
  cause:
    | "generate-requested"
    | "candidate-produced"
    | "generation-succeeded"
    | "generation-failed"
    | "commit"
    | "draft-retention-elapsed";
}

/**
 * 允许的状态转换。**表外的转换是不存在的**，不要在没有对应事由时发明一条。
 *
 * 两条容易写错的：
 * - `adopted → adopted` 是合法的：同一张草稿重复采用幂等（把同一个文件再写一遍），
 *   不是错误，也不产生第二份素材。宿主可以据此判定「重复采用」而不是抛错。
 * - `draft → draft` 不在这张表里：再出一张候选是**新的一份草稿**（新 draftId），
 *   不是同一份草稿换了个状态。
 *
 * `pending` 有两条出口到 `adopted`：经过 `draft`（有候选可挑）与不经过（剧作家的后台
 * 排产在队列里把 draft + commit 一次做完）。两条都是真实的，别把后一条当成漏写。
 */
export const ASSET_LIFECYCLE_TRANSITIONS: readonly AssetLifecycleTransition[] = [
  // 受理：独立版后台排产走 pending；同步出图直接得到草稿，跳过 pending。
  { from: null, to: "pending", cause: "generate-requested" },
  { from: null, to: "draft", cause: "candidate-produced" },
  // 生成回执：成功得草稿、失败留错因。pending 之外不走这条。
  { from: "pending", to: "draft", cause: "generation-succeeded" },
  { from: "pending", to: "failed", cause: "generation-failed" },
  // 采用：草稿进素材表。重复采用还是 adopted（幂等），不是新状态。
  { from: "draft", to: "adopted", cause: "commit" },
  { from: "adopted", to: "adopted", cause: "commit" },
  // 后台排产的快捷路径：独立版剧作家在队列里把 draft + commit 一次做完，外部观察到的是
  // 「受理 → 已入库」，中间那个草稿态不对外暴露（没有候选可挑，工具调用本身就声明了最终 id）。
  { from: "pending", to: "adopted", cause: "commit" },
  // 过期：只在草稿区发生。入库的素材不会自己过期。
  { from: "draft", to: "expired", cause: "draft-retention-elapsed" },
];

const TRANSITION_KEYS: ReadonlySet<string> = new Set(
  ASSET_LIFECYCLE_TRANSITIONS.map((t) => `${t.from ?? ""}>${t.to}`),
);

/** 这一步转换合法吗。`from` 给 `null` 表示「这份素材此前不存在」。 */
export function canTransitionAsset(
  from: AssetLifecycleState | null,
  to: AssetLifecycleState,
): boolean {
  return TRANSITION_KEYS.has(`${from ?? ""}>${to}`);
}

/** 到了就不会再变的状态（宿主据此决定还要不要继续记账 / 发到货广播）。 */
export function isTerminalAssetState(state: AssetLifecycleState): boolean {
  return ASSET_LIFECYCLE_TERMINAL.has(state);
}

/** 只有入库的素材能被剧本引用（`<scene bg>` / `<actor>` 指向的都是 adopted）。 */
export function isAssetReferencable(state: AssetLifecycleState): boolean {
  return state === "adopted";
}

/**
 * 草稿保留期：超过它没被动过的草稿整份删掉（独立版 `DRAFT_TTL_MS` 的领域侧常量）。
 *
 * 放在这里是因为「候选能躺多久」是两边共用的承诺——工坊告诉用户「没选中的会自己消失」
 * 时，说的是这段时间。宿主可以自己决定怎么清理，但报给用户的天数得是同一个。
 */
export const ASSET_DRAFT_RETENTION_DAYS = 7;
