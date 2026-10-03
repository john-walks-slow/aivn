/**
 * 舞台外壳的视图枚举：舞台 / 回顾 / 路线 / CG / 工坊。
 *
 * 工坊与前四个是**同一种东西**——同一个外壳下的五个视图，不是一个盖在舞台上的浮层。
 * 从标题页直达工坊靠 URL 带上 `?view=workshop`（舞台外壳只多认这一个 query 参数），
 * 好处是顶栏跟侧栏跟舞台完全一致，玩家看不出自己是从哪进来的。
 */

/** 视图 id。舞台是默认项，其余四个由侧栏导航切换。 */
export type StageView = "stage" | "backlog" | "route" | "cg" | "workshop";

/** 视图的中文名：侧栏导航、视图栏标题与 README 共用一份，不各写各的。 */
export const VIEW_LABEL: Record<StageView, string> = {
  stage: "舞台",
  backlog: "回顾",
  route: "路线",
  cg: "CG",
  workshop: "工坊",
};

/** 工坊内的八个页签。会话（旧称线程）不占页签位——它是「对话」页内部的一层。 */
export type WorkshopTab = "chat" | "play" | "characters" | "memory" | "assets" | "files" | "agent" | "settings";

const VIEWS: StageView[] = ["stage", "backlog", "route", "cg", "workshop"];
const TABS: WorkshopTab[] = ["chat", "play", "characters", "memory", "assets", "files", "agent", "settings"];

/**
 * 认 URL 上的 `view=`：认不出（缺省、拼错）一律回舞台。
 * 宁可落到舞台也不能落到工坊——工坊是外壳里的一个视图，落错了玩家看到的是空页面。
 */
export function stageViewFromQuery(search: string | null | undefined): StageView {
  const raw = new URLSearchParams(search ?? "").get("view");
  return VIEWS.find((v) => v === raw) ?? "stage";
}

/** 认 URL 上的 `tab=`（仅工坊视图有意义）：认不出回「对话」，那是工坊的首页。 */
export function stageTabFromQuery(search: string | null | undefined): WorkshopTab {
  const raw = new URLSearchParams(search ?? "").get("tab");
  return TABS.find((t) => t === raw) ?? "chat";
}

/**
 * 认 URL 上的 `workshop=1`：这一条连接**不开演**（服务端据此跳过 autostart，
 * 也不建周目、不计语音观众）。标题页「工坊」与就绪门里的补齐链接走它。
 *
 * 与 `view=` 分开是有意的：`view` 说“落在哪个视图”，`workshop=1` 说“这条连接
 * 是不是真的在开演”。于是从工坊点「回顾」可以重挂成一条真舞台连接并落在回顾，
 * 而不必先把人丢回舞台。
 */
export function workshopConnectionFromQuery(search: string | null | undefined): boolean {
  return new URLSearchParams(search ?? "").get("workshop") === "1";
}

/**
 * 工坊直达地址。工坊没有独立路由——它是舞台外壳的第五个视图，所以入口就是
 * 舞台地址带上 `view=workshop`（`tab=` 直接落在某一页，如素材页）。
 */
export function workshopUrl(playId: string, tab?: WorkshopTab): string {
  return `/play/${playId}/stage?view=workshop&workshop=1${tab ? `&tab=${tab}` : ""}`;
}
