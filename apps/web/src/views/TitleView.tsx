import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { api, readinessAdvice, readinessMissing, type PlayDetail, type SaveInfo } from "../api.js";
import { navigate } from "../router.jsx";

/** Title Screen：开始新周目（就绪门）/ 继续 / 周目 / 工坊 / 素材与配置 / 导出剧目包。 */
export function TitleView({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
    api
      .listSaves(playId)
      .then(setSaves)
      .catch((e: Error) => setError(e.message));
  }, [playId]);
  useEffect(reload, [reload]);

  const readiness = detail?.readiness;
  const missing = readiness ? readinessMissing(readiness) : [];
  const advice = readiness ? readinessAdvice(readiness) : [];
  const current = saves.find((s) => s.current) ?? null;

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

  const removePlay = (): void => {
    const title = detail?.play.title ?? playId;
    if (!window.confirm(`删除剧目「${title}」？剧本、素材与全部存档将一并删除，不可恢复。`)) return;
    api
      .deletePlay(playId)
      .then(() => navigate("/"))
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className="screen title-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate("/")}>
          <span className="btn-icon">
            <Icon name="back" /> 剧目库
          </span>
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {detail && (
        <div className="title-body">
          <h1>{detail.play.title}</h1>
          <p className="title-premise">{detail.play.premise}</p>
          <p className="muted small">
            {detail.play.characters.map((c) => c.name).join(" · ") || "（无角色）"}
          </p>

          <div className="title-menu">
            <button
              className="primary"
              disabled={!readiness?.ready || starting}
              title={readiness?.ready ? "" : `缺：${missing.join("、")}`}
              onClick={startNew}
            >
              开始新周目
            </button>
            {current && (
              <button onClick={() => navigate(`/play/${playId}/stage`)}>
                继续（{current.name}）
              </button>
            )}
            <button onClick={() => navigate(`/play/${playId}/saves`)}>
              周目{saves.length > 0 ? `（${saves.length}）` : ""}
            </button>
            <button onClick={() => navigate(`/play/${playId}/workshop`)}>工坊</button>
            <a className="btn-as-label" href={`/api/plays/${playId}/export`}>
              导出剧目包
            </a>
            <button className="ghost-btn danger-btn" onClick={removePlay}>
              删除剧目
            </button>
          </div>

          {saves.length > 0 && (
            <p className="muted small">
              已有 {saves.length} 个周目，每个周目一棵独立故事树，互不覆盖。
            </p>
          )}

          {!readiness?.ready && missing.length > 0 && (
            <p className="title-gate">
              就绪门未过（缺：{missing.join("、")}）——请到
              <button className="link-btn" onClick={() => navigate(`/play/${playId}/workshop`)}>
                工坊
              </button>
              与 AI 共创补齐，或到
              <button className="link-btn" onClick={() => navigate(`/play/${playId}/assets`)}>
                素材与配置
              </button>
              手动补齐。
            </p>
          )}
          {readiness?.ready && advice.length > 0 && (
            <p className="muted small">
              还没有 {advice.join("、")}——可以开演（舞台落氛围底色、没有立绘的角色不上台），
              也可到
              <button className="link-btn" onClick={() => navigate(`/play/${playId}/workshop`)}>
                工坊
              </button>
              让 AI 先把底图和定妆照生成出来。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
