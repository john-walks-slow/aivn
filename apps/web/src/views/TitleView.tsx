import { useCallback, useEffect, useState } from "react";
import { api, type PlayDetail } from "../api.js";
import { navigate } from "../router.jsx";

/** Title Screen：开始游戏（就绪门）/ 继续 / 素材与配置 / 导出剧目包。 */
export function TitleView({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [playId]);
  useEffect(reload, [reload]);

  const readiness = detail?.readiness;
  const missing: string[] = [];
  if (readiness) {
    if (!readiness.premise) missing.push("premise");
    if (!readiness.characterSprites) missing.push("角色立绘映射");
    if (!readiness.background) missing.push("背景图");
  }

  const removePlay = (): void => {
    const title = detail?.play.title ?? playId;
    if (!window.confirm(`删除剧目「${title}」？剧本、素材与会话将一并删除，不可恢复。`)) return;
    api
      .deletePlay(playId)
      .then(() => navigate("/"))
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className="screen title-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate("/")}>
          ← 剧目库
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
              disabled={!readiness?.ready}
              title={readiness?.ready ? "" : `缺：${missing.join("、")}`}
              onClick={() => navigate(`/play/${playId}/stage?mode=start`)}
            >
              开始游戏
            </button>
            {readiness?.ready && !readiness.hasSession && (
              <span className="muted small">尚无进度（开始即新档）</span>
            )}
            {readiness?.hasSession && (
              <button onClick={() => navigate(`/play/${playId}/stage?mode=continue`)}>继续</button>
            )}
            <button onClick={() => navigate(`/play/${playId}/workshop`)}>工坊</button>
            <button onClick={() => navigate(`/play/${playId}/assets`)}>素材与配置</button>
            <a className="btn-as-label" href={`/api/plays/${playId}/export`}>
              导出剧目包
            </a>
            <button className="ghost-btn danger-btn" onClick={removePlay}>
              删除剧目
            </button>
          </div>

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
        </div>
      )}
    </div>
  );
}
