import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedImageEntry } from "@aivn/core";
import type { PlayStore } from "./store.js";

/**
 * 出图台账（`assets/generated.json`）的只读视图：CG 页要的那一份。
 *
 * 直读盘、不建 runtime——runtime 会挂编排器、连工坊通道，而这一页只想知道盘上有哪些图。
 * 文件是权威：path 指向的文件不在了，那条记录不算数。
 *
 * 剧目内所有出图（工坊与剧作家共用的那个 PlayAssets）都记进这张表，一条路。
 */
/** 台账条目：`prompt` 在这里必填（台账的意义就是「这张图当初用什么描述出的」）。 */
export type GeneratedLedgerEntry = GeneratedImageEntry & { prompt: string };

export async function readPlayLedgerEntries(playId: string, store: PlayStore): Promise<GeneratedLedgerEntry[]> {
  const table = await store.ledger();
  const out: (GeneratedImageEntry & { prompt: string })[] = [];
  for (const [id, entry] of Object.entries(table)) {
    if (!entry?.path || !entry.prompt) continue;
    if (entry.kind !== "cg" && entry.kind !== "background") continue;
    if (!existsSync(join(store.dir, entry.path))) continue;
    out.push({
      id,
      type: entry.kind === "cg" ? "cg" : "bg",
      url: `/plays/${playId}/${entry.path}`,
      prompt: entry.prompt,
    });
  }
  return out;
}
