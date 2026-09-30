/**
 * 舞台外壳的视图枚举：舞台 / 回顾 / 路线 / 工坊。
 *
 * 工坊与前三个是**同一种东西**——同一个外壳下的四个视图，不是一个盖在舞台上的浮层。
 * 从标题页直达工坊靠 URL 带上 `?view=workshop`（舞台外壳只多认这一个 query 参数），
 * 好处是顶栏跟侧栏跟舞台完全一致，玩家看不出自己是从哪进来的。
 */

/** 视图 id。舞台是默认项，其余三个由侧栏导航切换。 */
export type StageView = "stage" | "backlog" | "route" | "workshop";

/** 视图的中文名：侧栏导航、视图栏标题与 README 共用一份，不各写各的。 */
export const VIEW_LABEL: Record<StageView, string> = {
  stage: "舞台",
  backlog: "回顾",
  route: "路线",
  workshop: "工坊",
};

/** 工坊内的五个页签。会话（旧称线程）不占页签位——它是「对话」页内部的一层。 */
export type WorkshopTab = "chat" | "assets" | "files" | "memory" | "settings";

const VIEWS: StageView[] = ["stage", "backlog", "route", "workshop"];
const TABS: WorkshopTab[] = ["chat", "assets", "files", "memory", "settings"];

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
