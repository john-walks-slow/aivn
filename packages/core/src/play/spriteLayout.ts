/**
 * 立绘站位：按在场人数自动分配，剧本没点名就不用手写位置。
 *
 * 为什么要有这层：gal 里「谁站哪」九成是作者随手排的，模型去写 `at="left"` 只会写出
 * 一个人挤在中间、两个人叠在一起的结果——它在写文本时没有「画面」的概念。
 * 人数决定站位是唯一可靠的默认；作者真正想改的时候（`at="left"`）再让它退出自动。
 *
 * 三条规则，都不需要数字：
 * - 1 人居中。
 * - 2 人分居两侧，把中间让给舞台（两人对话时中间是空的，这是舞台惯例）。
 * - 3 人及以上左中右，人再多就一路往外挤，宁可让人小一点也不要糊成一片。
 * - 后进的人在右边：gal 里后来者从右边入画，模型凭直觉也倾向把新人放右。
 *
 * 手动 `at` 的角色退出自动排布，剩下的人按**剩余人数**重排——所以「主角固定居中、
 * 配角自动」是能写出来的（给主角 `at="center"`，配角不写）。
 */

export const POSITIONS = [
  "left",
  "center",
  "right",
  "far-left",
  "far-right",
  "edge-left",
  "edge-right",
  "bleed-left",
  "bleed-right",
] as const;
export type SpritePosition = (typeof POSITIONS)[number];

export function isSpritePosition(value: unknown): value is SpritePosition {
  return typeof value === "string" && (POSITIONS as readonly string[]).includes(value);
}

/** 站位档名的显示名（编辑器下拉与告警用）。 */
export const POSITION_LABELS: Record<SpritePosition, string> = {
  left: "左",
  center: "中",
  right: "右",
  "far-left": "远左",
  "far-right": "远右",
  "edge-left": "边左",
  "edge-right": "边右",
  "bleed-left": "贴边左",
  "bleed-right": "贴边右",
};

/** 剧本里也认这些单字母写法（`at="l"` 不如 `at="left"` 直观，但模型确实会这么写）。 */
export const POSITION_ALIASES: Record<string, SpritePosition> = {
  l: "left",
  c: "center",
  r: "right",
};

/**
 * 挑 N 个不冲突的站位档，**跳过已被手动占用的**。
 *
 * 候选池是**由内到外**排好序的：人少时都往中间站，人多时才一路挤到边上，
 * 这正是舞台的视觉习惯。唯一的例外是 2 人——两个都站正中间没有意义，
 * 中间该空出来，那是两人对话时舞台的留白。
 */
function freeSlots(count: number, taken: ReadonlySet<SpritePosition>): SpritePosition[] {
  if (count <= 0) return [];
  const byInnerness: SpritePosition[] =
    count === 2
      ? ["left", "right", "far-left", "far-right", "edge-left", "edge-right", "bleed-left", "bleed-right", "center"]
      : [
          "center",
          "left",
          "right",
          "far-left",
          "far-right",
          "edge-left",
          "edge-right",
          "bleed-left",
          "bleed-right",
        ];
  return byInnerness.filter((p) => !taken.has(p)).slice(0, count);
}

/**
 * 一次算完在场每个人的站位。
 *
 * @param order    在场角色 id，**按进场顺序**（谁最后进来在数组末尾）
 * @param explicit 剧本显式点名过 `at` 的角色 id → 站位。它们不参与自动排布，
 *                 剩下的人按**剩余人数**重排（而不是按总人数），否则手动指定一个人
 *                 之后其他人会整体偏一边，中间空出一个洞。
 *
 * @returns 角色 id → 站位档名。显式指定过的原样返回。
 */
export function layoutSprites(
  order: readonly string[],
  explicit: ReadonlyMap<string, SpritePosition> = new Map(),
): Map<string, SpritePosition> {
  const out = new Map<string, SpritePosition>();
  const auto = order.filter((id) => !explicit.has(id));
  // 手动占掉的档位要从候选里划掉：主角钉在 center 之后，剩下那个自动角色
  // 再被分到 center 就是两个人叠在同一个像素点上——「按剩余人数重排」只解决了
  // 整体偏移，没解决占位冲突。
  const taken = new Set<SpritePosition>();
  for (const [id, pos] of explicit) {
    if (order.includes(id)) taken.add(pos);
  }
  const slots = freeSlots(auto.length, taken);
  // freeSlots 给的是**对称的一组档**（3 人 → center/left/right），没有先后之分。
  // 谁站哪一档由进场顺序决定：先来的拿最靠内的那档（3 人里就是 center），
  // 后进的往外站。进场顺序在剧本里就是「先请出来的人」，读起来是有意义的。
  auto.forEach((id, i) => {
    out.set(id, slots[i] ?? "center");
  });
  for (const [id, pos] of explicit) {
    if (order.includes(id)) out.set(id, pos);
  }
  return out;
}

/**
 * 解析剧本写的 `at`：具名档位与单字母别名都认，认不出来落 null（走自动）。
 *
 * 故意不抛错也不猜：位置写错是**可恢复**的（自动排布照样有位置），
 * 而抛错会让整条 `<actor>` 丢掉——人直接不登场，比站错位糟糕得多。
 */
export function parsePosition(value: string | undefined): SpritePosition | null {
  if (value === undefined) return null;
  const key = value.trim().toLowerCase();
  if (key === "") return null;
  if (isSpritePosition(key)) return key;
  return POSITION_ALIASES[key] ?? null;
}
