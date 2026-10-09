/**
 * 草稿区 `media-cache/drafts/`：一张出好的图（立绘是抠好底的透明 PNG）躺在那里，等采用才进 `assets/`。
 *
 * 出图与入库拆开是为了「一次出几张候选、用户挑一张」这条流程。草稿是中间物不是剧目内容，
 * 两个宿主落在同一个位置、写同一份 `draft.json`。寿命由共享契约 `ASSET_DRAFT_RETENTION_DAYS`
 * 推出来——「候选能躺多久」是两边对用户说的同一句话；清理由下一次写草稿顺手做，删不掉就算了。
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ASSET_DRAFT_RETENTION_DAYS, type SpriteFraming, type SpriteStature } from "@aivn/core";
import type { AssetKind } from "./catalog.js";
import type { ImageAspect } from "./image.js";

/** 草稿寿命：超过它由下一次写草稿顺手清掉（天数由共享契约推导，不手写）。 */
export const DRAFT_TTL_MS = ASSET_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** 草稿目录里的 `draft.json`：出图那一刻的意图，采用不在同一个回合也能拿回来。 */
export interface DraftRecord {
  draftId: string;
  /** 剧目目标；通用出图的记录没有它。 */
  kind?: AssetKind;
  name?: string;
  spriteId?: string;
  variant?: string;
  framing?: SpriteFraming;
  stature?: SpriteStature;
  title?: string;
  /** 出图时的画幅（采用时按目标重算，这里只作留痕）。 */
  aspect: ImageAspect;
  prompt: string;
  /** 成图扩展名（含点）；立绘是抠底后的 `.png`。 */
  imageExt: string;
  /** 抠底前原片的扩展名（立绘才有）。 */
  sourceExt?: string;
  createdAt: string;
  committedAt?: string;
}

/** 草稿去掉落盘细节的那部分——落盘细节由 `writeDraft` 从字节里认，不由调用方声明。 */
export type DraftPlan = Omit<DraftRecord, "imageExt" | "sourceExt">;

/** 要写进草稿目录的文件：成图 +（可选）抠底前原片。 */
export interface DraftFiles {
  image: Buffer;
  imageExt: string;
  source?: { data: Buffer; ext: string };
}

/** 落一张草稿的回执。 */
export interface DraftedDraft {
  draftId: string;
  kind?: AssetKind;
  /** 剧目内相对路径（`media-cache/drafts/<id>/image.png`），预览用。 */
  path: string;
  /** 绝对路径（宿主要读回自己刚写的图作垫图）。 */
  absPath: string;
  aspect: ImageAspect;
  /** 立绘那次的抠底体检（背景 / 插图没有）。 */
  cutout?: { coverage: number; figureHeight: number };
}

/** 草稿目录（绝对路径）。 */
export function draftDir(dir: string, draftId: string): string {
  return join(dir, "media-cache", "drafts", draftId);
}

/** 草稿根目录（清理过期草稿时列目录用）。 */
export function draftsDir(dir: string): string {
  return join(dir, "media-cache", "drafts");
}

/** 新草稿的新身份。 */
export function newDraftId(): string {
  return randomUUID();
}

/**
 * 落一张草稿：成图 +（立绘的）抠底前原片 + `draft.json`；顺手清过期草稿。
 *
 * 扩展名一律从**字节**认（`imageExt` / `source.ext` 由调用方从 `extOf(mimeOfBuffer(…))` 得到），
 * 不用调用方另说一遍，否则 `draft.json` 里的 ext 与真实文件名会各自漂。
 */
export async function writeDraft(
  dir: string,
  plan: DraftPlan,
  files: DraftFiles,
  cutout?: { coverage: number; figureHeight: number },
): Promise<DraftedDraft> {
  const dirPath = draftDir(dir, plan.draftId);
  await mkdir(dirPath, { recursive: true });
  await writeFile(join(dirPath, `image${files.imageExt}`), files.image);
  if (files.source) await writeFile(join(dirPath, `source${files.source.ext}`), files.source.data);
  const record: DraftRecord = {
    ...plan,
    imageExt: files.imageExt,
    ...(files.source ? { sourceExt: files.source.ext } : {}),
  };
  await writeFile(join(dirPath, "draft.json"), `${JSON.stringify(record, null, 2)}\n`);
  await pruneDrafts(dir);
  const rel = `media-cache/drafts/${plan.draftId}/image${files.imageExt}`;
  return {
    draftId: plan.draftId,
    ...(plan.kind ? { kind: plan.kind } : {}),
    path: rel,
    absPath: join(dirPath, `image${files.imageExt}`),
    aspect: plan.aspect,
    ...(cutout ? { cutout } : {}),
  };
}

/** 草稿成图的字节（采用时要把同一份再写进 `assets/`）。 */
export function readDraftImage(dir: string, draftId: string, imageExt: string): Promise<Buffer> {
  return readFile(join(draftDir(dir, draftId), `image${imageExt}`));
}

/** 草稿留底原片的字节（立绘采用时搬进 `media-cache/sprite-sources/`）。 */
export function readDraftSource(dir: string, draftId: string, sourceExt: string): Promise<Buffer> {
  return readFile(join(draftDir(dir, draftId), `source${sourceExt}`));
}

/** 读一份草稿记录；不存在给一句能读的错（它迟早会被清理，报错要说到点上）。 */
export async function loadDraft(dir: string, draftId: string): Promise<DraftRecord> {
  const id = draftId.trim();
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error(`草稿 id「${draftId}」非法`);
  const file = join(draftDir(dir, id), "draft.json");
  if (!existsSync(file)) {
    throw new Error(
      `找不到草稿 ${id}：它可能已被清理（草稿留 ${ASSET_DRAFT_RETENTION_DAYS} 天），或者 id 记错了——重新出一次图。`,
    );
  }
  return JSON.parse(await readFile(file, "utf8")) as DraftRecord;
}

/** 入库留痕（best-effort）：草稿目录迟早会被清理，这一笔只为当下看得出「已经采用过」。 */
export async function markCommitted(dir: string, draftId: string, draft: DraftRecord): Promise<void> {
  try {
    const file = join(draftDir(dir, draftId), "draft.json");
    await writeFile(file, `${JSON.stringify({ ...draft, committedAt: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    // 素材已经落好了，为一条留痕报错不值
  }
}

/**
 * 清掉过期草稿：超过 `DRAFT_TTL_MS` 没动过的整份目录删掉。删不掉就算了，不打断出图。
 *
 * `now` 只为测试注入；生产路径不传。
 */
export async function pruneDrafts(dir: string, now = Date.now()): Promise<void> {
  const root = draftsDir(dir);
  if (!existsSync(root)) return;
  const cutoff = now - DRAFT_TTL_MS;
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(root, entry.name);
      try {
        if ((await stat(dirPath)).mtimeMs < cutoff) await rm(dirPath, { recursive: true, force: true });
      } catch {
        // 单份草稿删不掉不该影响这次出图
      }
    }
  } catch {
    // 草稿区列不出来同理
  }
}
