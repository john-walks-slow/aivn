import { useCallback, useEffect, useState } from "react";
import type { CgEntry } from "@aivn/core";
import { Icon } from "@aivn/stage";
import { api } from "../api.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";

/**
 * CG 页：这一场出过的插图一张张摆出来，提示词随时能看。
 *
 * 清单由服务端合成（`GET /api/plays/:id/cg`）：静态素材（`assets/cg`，用户在工坊导入或让
 * 工坊生成的）与站内预发射生成的图各占一半来源，同一 id 只出现一次。展示这一页的理由很直接——
 * 「这场戏的图到底出成什么样」在演出里只能等它自己弹出来，而排查「图不对」时人要能立刻
 * 翻到那张图、看清它当初是照哪句描述生成的。
 */
export function CgView({
  playId,
  nonce = 0,
  onBackToStage,
  onOpenWorkshop,
}: {
  playId: string;
  /** 打开视图时递增即重新拉一次（生图到货后回到本页能看到新图）。 */
  nonce?: number;
  /** 空态的两个去处：回舞台点「生图」，或去工坊素材页导入。 */
  onBackToStage?: () => void;
  onOpenWorkshop?: () => void;
}) {
  const [entries, setEntries] = useState<CgEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .cgCatalog(playId)
      .then((r) => {
        setEntries(r.entries);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [playId, nonce]);

  const close = useCallback(() => setZoom(null), []);

  return (
    <div className="cg-screen">
      {error && <div className="error-banner">{error}<button type="button" className="notice-close" aria-label="收起这条" onClick={() => setError(null)}><Icon name="close" size={12} /></button></div>}
      {loading && entries.length === 0 ? (
        <div className="cg-blank">
          <div className="overlay">读取 CG…</div>
        </div>
      ) : entries.length === 0 ? (
        <div className="cg-blank">
          <div className="cg-empty">
            <Icon name="assets" size={38} />
            <p className="cg-empty-title">这里还没有插图</p>
            <p className="muted small">
              在舞台上点「生图」就能画这一幕，也可以从素材页导入现成的图。
            </p>
            {(onBackToStage || onOpenWorkshop) && (
              <div className="cg-empty-actions">
                {onBackToStage && (
                  <button type="button" className="primary" onClick={onBackToStage}>
                    回到舞台生成
                  </button>
                )}
                {onOpenWorkshop && (
                  <button type="button" className="ghost-btn" onClick={onOpenWorkshop}>
                    去工坊管理素材
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="cg-grid">
          {entries.map((entry, i) => (
            <CgCard key={entry.id} entry={entry} onOpen={() => setZoom(i)} />
          ))}
        </div>
      )}

      {zoom !== null && (
        <ImageLightbox
          images={entries.map((entry) => ({
            url: entry.url,
            caption: captionFor(entry),
            detail: detailFor(entry),
          }))}
          index={zoom}
          onIndex={setZoom}
          onClose={close}
        />
      )}
    </div>
  );
}

/** 一张 CG：网格里只有图（一格一张，像相册）。
 *  提示词是「这张图当初照什么生成的」，属于点开大图之后的事——摆在网格里，
 *  一屏看不到两张图，而这一页是用来挑图的。 */
function CgCard({ entry, onOpen }: { entry: CgEntry; onOpen: () => void }) {
  return (
    <article className="cg-card">
      <button className="cg-thumb" onClick={onOpen} title="看大图">
        <img src={entry.url} alt={entry.id} loading="lazy" />
        <span className="cg-tag">
          {entry.id}
          <span className="cg-origin">{entry.origin === "generated" ? "站内生成" : "素材"}</span>
        </span>
      </button>
    </article>
  );
}

/** 大图下面那一块：先一行 id（图片来源），再是描述与提示词原文。 */
function captionFor(entry: CgEntry): string {
  return `${entry.id} · ${entry.origin === "generated" ? "站内生成" : "素材"}`;
}

function detailFor(entry: CgEntry): string {
  const parts = [
    entry.description ? `描述：${entry.description}` : "",
    entry.prompt ? `提示词：${entry.prompt}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : "（这张图没有留下描述与提示词）";
}