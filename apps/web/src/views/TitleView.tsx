import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { Modal } from "../ui/Modal.js";
import { api, assetUrl, readinessAdvice, readinessMissing, type PlayDetail, type SaveInfo } from "../api.js";
import { navigate } from "../router.jsx";
import { workshopUrl } from "../stage/view.js";

/** 标题画面的底图：取这张剧目的第一张背景素材，没有就走主题色的和纸渐变。 */
function titleArt(playId: string, files: string[] | undefined): string | null {
  const first = files?.[0];
  return first ? assetUrl(playId, "backgrounds", first) : null;
}

/** Title Screen：背景 + 作品名 + 竖排动词菜单（继续 / 开始新周目 / 周目 / 工坊 / 导出 / 删除）。 */
export function TitleView({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [art, setArt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
      .then((assets) => setArt(titleArt(playId, assets.backgrounds)))
      .catch(() => setArt(null));
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
    setConfirmingDelete(true);
  };

  const doRemovePlay = (): void => {
    setConfirmingDelete(false);
    api
      .deletePlay(playId)
      .then(() => navigate("/"))
      .catch((e: Error) => setError(e.message));
  };

  return (
    <div className={`screen title-screen${art ? " has-art" : ""}`}>
      {art && <img className="title-art" src={art} alt="" />}

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {detail && (
        <div className="title-body">
          <div className="title-text">
            <h1 className="title-name">{detail.play.title}</h1>
            <p className="title-premise">{detail.premise || "（故事前提待补）"}</p>
            <p className="title-chars">
              {detail.play.characters.map((c) => c.name).join(" · ") || "（无角色）"}
            </p>

            {/* 缺什么都不是门槛，只是「还没有」。没写故事前提照样能开演，
                剧作家会自由发挥——想让它自由发挥就什么都别写。 */}
            {missing.length > 0 && (
              <p className="title-note">
                还没有{missing.join("、")}——现在开演，剧作家会自己发挥。想要一个确定的世界，去
                <button className="link-btn" onClick={() => navigate(workshopUrl(playId, "memory"))}>
                  工坊的记忆页
                </button>
                写「世界与人物设定」。
              </p>
            )}
            {advice.length > 0 && (
              <p className="title-note">
                还没有 {advice.join("、")}——可以开演（舞台落氛围底色、没有立绘的角色不上台），
                也可到
                <button className="link-btn" onClick={() => navigate(workshopUrl(playId, "assets"))}>
                  工坊
                </button>
                让 AI 先把底图和定妆照生成出来。
              </p>
            )}
            {saves.length === 0 && (
              <p className="title-note">还没有周目。开始新周目，这张剧目的第一棵故事树就在那里。</p>
            )}
          </div>

          {/* 游玩动作与剧目管理分两组：前者是玩家在标题画面上按的，后者是作者的日常操作 */}
          <div className="title-right">
            <nav className="title-menu">
              {/* 有周目时，「继续」是主项且排在前：来得最多的动作该是最显眼的那一个。
                  开始新周目永远排在它后面，没有周目时它自己就是主项。 */}
              {current ? (
                <button className="title-item main" onClick={() => navigate(`/play/${playId}/stage`)}>
                  继续
                  <span className="title-item-sub">{current.name}</span>
                </button>
              ) : null}
              <button
                className={`title-item${current ? "" : " main"}`}
                disabled={starting}
                onClick={startNew}
              >
                开始新周目
              </button>
              <button className="title-item" onClick={() => navigate(`/play/${playId}/saves`)}>
                周目
                {saves.length > 0 && <span className="title-item-sub">{saves.length} 棵故事树</span>}
              </button>
            </nav>

            <div className="title-manage">
              <button className="title-item sub" onClick={() => navigate(workshopUrl(playId))}>
                工坊
              </button>
              <a className="title-item sub" href={`/api/plays/${playId}/export`}>
                导出剧目包
              </a>
              <button className="title-item sub" onClick={removePlay}>
                删除剧目
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="title-foot">
        <button className="ghost-btn" onClick={() => navigate("/")}>
          <span className="btn-icon">
            <Icon name="back" size={15} /> 剧目库
          </span>
        </button>
        <span className="title-foot-id">{playId}</span>
      </footer>

      {confirmingDelete && (
        <Modal
          title="删除剧目"
          hint={
            <>
              删掉「{detail?.play.title ?? playId}」后，剧本、素材与全部 {saves.length} 个周目存档一并消失，无法恢复。
            </>
          }
          width={440}
          onClose={() => setConfirmingDelete(false)}
          footer={
            <>
              <button onClick={() => setConfirmingDelete(false)}>取消</button>
              <button className="primary danger-btn" onClick={doRemovePlay}>
                确认删除
              </button>
            </>
          }
        >
          <p className="muted small">要删的是这个剧目本身，不是某一个周目。</p>
        </Modal>
      )}
    </div>
  );
}
