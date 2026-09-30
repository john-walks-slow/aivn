import type { PlayFile } from "../api.js";

/**
 * 记忆页的分组：工坊「记忆」tab 把 memory/** 按「剧作家怎么用」摆开，
 * 而不是照抄目录树。
 *
 * 分组本身就是说明书——玩家在这里一眼看到哪张卡每轮都在、哪张是按需读、哪张碰不得。
 * `arcs/` 与 `archive/` 是纪元压缩的机器产物（谱系快照按 arcId 引用、按分支过滤防剧透），
 * 手改或手建会绕过那道过滤，所以整组只读：它出现在列表里，但不给编辑器。
 */
export type MemorySectionId = "always" | "characters" | "index" | "derived";

export interface MemorySection {
  id: MemorySectionId;
  title: string;
  /** 这组在引擎里的角色，一句话说明（界面上直接显示）。 */
  note: string;
  /** 整组是否只读：只读组不给出编辑器（逐文件仍看服务端白名单的 writable）。 */
  readOnly: boolean;
  files: PlayFile[];
}

const SECTIONS: { id: MemorySectionId; title: string; note: string; match: (path: string) => boolean }[] = [
  {
    id: "always",
    title: "常驻设定",
    note: "每一轮都注入剧作家的上下文：世界观前提与创作口径。改完等当前这一轮写完即生效。",
    match: (p) => p.startsWith("memory/always/"),
  },
  {
    id: "characters",
    title: "角色设定",
    note: "每个角色一份：人设与台词风格。文件名即角色 id。",
    match: (p) => p.startsWith("memory/always/characters/"),
  },
  {
    id: "index",
    title: "设定卡",
    note: "只把标题与摘要注入上下文，细节由剧作家按需读。子目录随意建，`locations/`、`lore/` 只是惯例。",
    match: (p) => p.startsWith("memory/index/"),
  },
  {
    id: "derived",
    title: "纪元产物（只读）",
    note: "纪元压缩自动写的摘要与检索切片，按谱系分支过滤防剧透。手改会绕过过滤。",
    match: (p) => p.startsWith("memory/arcs/") || p.startsWith("memory/archive/"),
  },
];

/**
 * 剧目文件 → 记忆分组。保持服务端给的顺序（`index/` 的目录层次是这个顺序的一部分），
 * 空组不出现（新建剧目不该看到四个空标题）。
 */
export function memorySections(files: PlayFile[]): MemorySection[] {
  return SECTIONS.flatMap((section) => {
    const inSection = files.filter((f) => section.match(f.path));
    if (inSection.length === 0) return [];
    return [{ ...section, readOnly: section.id === "derived", files: inSection }];
  });
}
