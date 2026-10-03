import { useCallback, useEffect, useState } from "react";
import type { CgEntry } from "@stage-ai/core";
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
export function CgView({ playId, nonce = 0 }: { playId: string; /** 打开视图时递增即重新拉一次（生图到货后回到本页能看到新图）。 */ nonce?: number }) {
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
      {error && <div className="error-banner">{error}</div>}
      {loading && entries.length === 0 ? (
        <div className="cg-blank">
          <div className="overlay">读取 CG…</div>
        </div>
      ) : entries.length === 0 ? (
        <div className="cg-blank">
          <div className="overlay">还没有插图。演出时在舞台上点「生图」，或去工坊的素材页导入。</div>
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
          images={entries.map((entry) => ({ url: entry.url, caption: captionFor(entry) }))}
          index={zoom}
          onIndex={setZoom}
          onClose={close}
        />
      )}
    </div>
  );
}

/** 一张 CG：图在上，id 与提示词在下。提示词就是这一页要给人看的东西，摆明写。 */
function CgCard({ entry, onOpen }: { entry: CgEntry; onOpen: () => void }) {
  return (
    <article className="cg-card">
      <button className="cg-thumb" onClick={onOpen} title="看大图">
        <img src={entry.url} alt={entry.id} loading="lazy" />
      </button>
      <div className="cg-body">
        <strong className="cg-id" title={entry.id}>
          {entry.id}
          <span className="cg-origin">{entry.origin === "generated" ? "站内生成" : "素材"}</span>
        </strong>
        {entry.description && <p className="cg-desc">{entry.description}</p>}
        {entry.prompt && <p className="cg-prompt">{entry.prompt}</p>}
        {!entry.description && !entry.prompt && <p className="cg-desc cg-none">（没有描述与提示词）</p>}
      </div>
    </article>
  );
}

function captionFor(entry: CgEntry): string {
  const detail = entry.description ?? entry.prompt;
  return detail ? `${entry.id} — ${detail}` : entry.id;
}