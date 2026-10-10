import { useCallback, useEffect, useState } from "react";
import { Icon, Modal, workshopUrl } from "@aivn/stage";
import {
  api,
  coverUrl,
  readinessAdvice,
  readinessMissing,
  type PlayDetail,
  type SaveInfo,
} from "../api.js";
import { navigate } from "../router.jsx";
import { plainSummary, playThemeColor, relativeTime } from "../ui/text.js";

/**
 * 标题画面：整屏封面 + 左下剧名 + 右下菜单。
 *
 * 菜单只有两层：玩的人按的（继续 / 新的周目 / 周目一览），与写的人按的（工坊、导出、删除）。
 * 后者压成一排小字，不和「继续」抢视线。缺素材不是门槛，只在菜单底下给一行提示和去处。
 */
export function TitleView({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [assets, setAssets] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 底图与剧目库封面同一套解析（指定的那张，没有就第一张背景、其次第一张插图）
  const art = detail ? coverUrl(playId, detail.play.cover, assets) : null;

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
    api
      .listSaves(playId)
      .then(setSaves)
      .catch((e: Error) => setError(e.message));
    api
      .listAssets(playId)
      .then(setAssets)
      .catch(() => setAssets(undefined));
  }, [playId]);
  useEffect(reload, [reload]);

  const readiness = detail?.readiness;
  const missing = readiness
    ? [...readinessMissing(readiness), ...readinessAdvice(readiness)]
    : [];
  const current = saves.find((s) => s.current) ?? null;
  const cast = (detail?.cast ?? []).map((c) => c.name ?? c.id).filter(Boolean);
  const summary = detail
    ? plainSummary(detail.premise, detail.play.title, 96)
    : "";

  /** 开始新周目：建一棵空树再进舞台，旧档不动。 */
  const startNew = (): void => {
    setStarting(true);
    api
      .createSave(playId)
      .then(() => navigate(`/play/${playId}/stage`))
      .catch((e: Error) => {
        setStarting(false);
        setError(e.message);
      });
  };

  const doRemovePlay = (): void => {
    setConfirmingDelete(false);
    api
      .deletePlay(playId)
      .then(() => navigate("/"))
      .catch((e: Error) => setError(e.message));
  };

  // Esc 回剧目库：标题画面是剧目的「门」，退一步就是库
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !confirmingDelete) navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingDelete]);

  const theme = playThemeColor(
    playId,
    (detail?.play as { themeColor?: string } | undefined)?.themeColor,
  );

  return (
    <div
      className={`screen title-screen${art ? " has-art" : ""}`}
      style={
        {
          "--play-accent": theme.accent,
          "--play-accent-glow": theme.glow,
          "--play-accent-dark": theme.dark,
        } as React.CSSProperties
      }
    >
      {art ? (
        <img className="title-art" src={art} alt="" />
      ) : (
        <div className="title-art title-art-blank" />
      )}
      <div className="title-veil" aria-hidden />

      <header className="title-top">
        <button
          type="button"
          className="title-back"
          onClick={() => navigate("/")}
          title="回到剧目库（Esc）"
        >
          <Icon name="back" size={15} />
          <span>剧目库</span>
        </button>
      </header>

      {error && (
        <div className="error-banner title-error" role="alert">
          {error}
          <button
            type="button"
            className="notice-close"
            aria-label="收起这条"
            onClick={() => setError(null)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {detail && (
        <>
          <section className="title-brand">
            <h1 className="title-name">{detail.play.title}</h1>
            {/* 一行剧情简介：这是玩家挑剧目的唯一线索。人物表不放这儿——
                知道「谁登场」是玩进去之后的事，摆在门外只是剧透。 */}
            {summary && <p className="title-premise">{summary}</p>}
          </section>

          <nav className="title-menu atri-menu" aria-label="标题菜单">
            {current && (
              <button
                type="button"
                className="atri-item is-continue"
                onClick={() => navigate(`/play/${playId}/stage`)}
                autoFocus
              >
                <span className="atri-label">CONTINUE</span>
                <span className="atri-sub">
                  {current.name} · {relativeTime(current.updatedAt)}
                </span>
              </button>
            )}

            <button
              type="button"
              className={`atri-item${!current ? " is-primary" : ""}`}
              disabled={starting}
              onClick={startNew}
              autoFocus={!current}
            >
              <span className="atri-label">START</span>
              {!current && <span className="atri-sub">NEW GAME</span>}
            </button>

            <button
              type="button"
              className={`atri-item${saves.length === 0 ? " is-disabled" : ""}`}
              disabled={saves.length === 0}
              onClick={() => navigate(`/play/${playId}/saves`)}
            >
              <span className="atri-label">LOAD</span>
              <span className="atri-sub">{saves.length} SAVES</span>
            </button>

            <button
              type="button"
              className="atri-item"
              onClick={() => navigate(workshopUrl(playId))}
            >
              <span className="atri-label">WORKSHOP</span>
              <span className="atri-sub">STUDIO</span>
            </button>

            <button
              type="button"
              className="atri-item"
              onClick={() => navigate("/settings")}
            >
              <span className="atri-label">SYSTEM</span>
              <span className="atri-sub">CONFIG</span>
            </button>

            <button
              type="button"
              className="atri-item"
              onClick={() => navigate("/")}
            >
              <span className="atri-label">EXIT</span>
              <span className="atri-sub">LIBRARY</span>
            </button>
          </nav>

          <footer className="title-footer">
            <div className="title-ops">
              <a
                className="title-op-link"
                href={`/api/plays/${playId}/export`}
                title="导出剧目包"
              >
                <Icon name="download" size={13} />
                <span>EXPORT</span>
              </a>
              <button
                type="button"
                className="title-op-btn danger"
                onClick={() => setConfirmingDelete(true)}
                title="删除剧目"
              >
                <Icon name="remove" size={13} />
                <span>DELETE</span>
              </button>
            </div>
            <p className="title-copyright">
              © AIVN Studio / Engine. All rights reserved.
            </p>
          </footer>

          {missing.length > 0 && (
            <div className="title-advice-capsule">
              <span>未就绪：{missing.join("、")}（可直接开始）</span>
              <button
                type="button"
                className="advice-link"
                onClick={() => navigate(workshopUrl(playId))}
              >
                前往工坊补齐 →
              </button>
            </div>
          )}
        </>
      )}

      {confirmingDelete && (
        <Modal
          title="删除剧目"
          hint={
            <>
              「{detail?.play.title ?? playId}」的剧本、素材与全部{" "}
              {saves.length} 个周目会一并删除，无法恢复。
            </>
          }
          width={440}
          onClose={() => setConfirmingDelete(false)}
          footer={
            <>
              <button onClick={() => setConfirmingDelete(false)}>取消</button>
              <button className="primary danger-btn" onClick={doRemovePlay}>
                删除
              </button>
            </>
          }
        >
          <p className="muted small">
            只想清掉某一次游玩，去「周目一览」里删那一个周目即可。
          </p>
        </Modal>
      )}
    </div>
  );
}
