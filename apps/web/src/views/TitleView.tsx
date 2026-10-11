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
import { navigate, settingsUrl } from "../router.jsx";
import { plainSummary, relativeTime } from "../ui/text.js";

/**
 * 标题画面：整屏封面 + 左下剧名 + 右下菜单。
 *
 * 菜单只有两层：玩的人按的（继续 / 新的周目 / 周目一览），与写的人按的（工坊、导出、删除）。
 * 后者压成一排小字，不和「继续」抢视线。WORKSHOP 的副标照旧是那枚 STUDIO（悬停/聚焦才浮出）；
 * 缺素材不是门槛（缺了也能直接开演），这时副标让位给一句恒显的极短推荐注——缺什么、去哪儿补，
 * 正文归工坊里那几页自己说。
 */
export function TitleView({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [assets, setAssets] = useState<Record<string, string[]> | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** 焦点环只在真的用键盘走过来时画——首屏那枚 autoFocus 不算（理由见下面的 effect）。 */
  const [keyboardNav, setKeyboardNav] = useState(false);

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

  // 焦点环按输入方式发牌。首屏那枚 autoFocus 是「Enter 立刻继续 / 开演」的落点，
  // 不是键盘导航，可浏览器把它一并算进 :focus-visible——于是一列没有底板的纯字上
  // 什么也没碰就浮出一圈主题色方块。鼠标/手指点过之后收环，用 Tab 回来时再挂上
  // （选择器在 app.css 的 .atri-menu.is-keyboard）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Tab") setKeyboardNav(true);
    };
    const onPointer = (): void => setKeyboardNav(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const current = saves.find((s) => s.current) ?? null;
  const summary = detail
    ? plainSummary(detail.premise, detail.play.title, 96)
    : "";
  /** 引擎手上还没有的东西（前提 / 立绘 / 背景图）——只用来写工坊入口旁那句推荐注。 */
  const missing = detail
    ? [
        ...readinessMissing(detail.readiness),
        ...readinessAdvice(detail.readiness),
      ]
    : [];

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

  return (
    <div className={`screen title-screen${art ? " has-art" : ""}`}>
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

          <nav
            className={`atri-menu${keyboardNav ? " is-keyboard" : ""}`}
            aria-label="标题菜单"
          >
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
              {/* 缺项时的推荐注：一小句挂在入口右侧，不是副标（副标只在悬停时浮出，
                  推荐点得让人不碰它也看得见），更不是一枚按钮。齐了就退回 STUDIO 副标。 */}
              {missing.length > 0 ? (
                <span className="atri-hint">去补齐{missing.join("、")}</span>
              ) : (
                <span className="atri-sub">STUDIO</span>
              )}
            </button>

            <button
              type="button"
              className="atri-item"
              onClick={() => navigate(settingsUrl(`/play/${playId}`))}
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

          {/* 底边一条：左边版权，右边两枚管理操作（导出 / 删除） */}
          <footer className="title-footer">
            <p className="title-copyright">
              © AIVN Studio / Engine. All rights reserved.
            </p>
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
          </footer>
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
