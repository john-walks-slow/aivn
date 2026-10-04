import { useCallback, useEffect, useMemo, useState } from "react";
import {
  characterCardPath,
  isProtagonist,
  PROTAGONIST_ID,
  serializeCharacterCard,
  spriteIdOf,
} from "@aivn/core";
import type { CharacterDocument, GeneratedAsset, PlayConfig } from "@aivn/core";
import { api, assetUrl, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { CharacterEditor } from "./CharacterEditor.js";
import { ImageLightbox } from "../ui/ImageLightbox.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog } from "../voice/useVoiceCatalog.js";

/** cast 里每个角色都有 id（服务端按文件名取的），这里只是把可选字段收成必填。 */
type Role = CharacterDocument & { id: string };

/** cast 是服务端解析好的整份角色卡，没有 id 的条目（理论上不存在）直接丢掉。 */
function rolesOf(detail: PlayDetail): Role[] {
  const roles = detail.cast.filter((doc): doc is Role => Boolean(doc.id));
  // 主角卡理应恒在（新建剧目就写好了一张）。真不在——没跑迁移脚本的老剧目、卡被清空——
  // 就补一张空卡：少了它，角色页连「主角」这个入口都没有，用户无处编辑、也无处导入，
  // 剧作家的角色表里则会少掉玩家。
  if (!roles.some((role) => isProtagonist(role.id))) {
    roles.unshift({ id: PROTAGONIST_ID, name: "你", body: "" });
  }
  return roles;
}

/**
 * 角色：主角卡与全部角色卡，同一个编辑器、同一份保存路径。
 *
 * 角色的真相源是 `characters/<id>.md`；主角只是 id 固定为 `protagonist` 的那一张，
 * 它不是一类特殊角色——能上台、有立绘、有音色，只是不给删（删了剧目就没有玩家了）。
 * play.json 在这条路径上一个字节都不参与。
 */
export function CharacterPane({
  playId,
  revision,
  subscribeAssetReady,
  onManageSprites,
}: {
  playId: string;
  revision: number;
  /** 注册素材到货回调（返回取消订阅）：导进来或刚画好的立绘要当场出现在缩略图上。 */
  subscribeAssetReady?: (handler: (asset: GeneratedAsset) => void) => () => void;
  /** 「打开立绘」：跳到素材页那个主体（这一页只管人格与音色，立绘归素材表）。 */
  onManageSprites?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  /** 改过的角色卡：保存时只写这些，没动过的卡不必为刷新 mtime 而重写一遍。 */
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string>(PROTAGONIST_ID);
  /** 新建角色的 id 输入：开表单、写着、还没落卡。 */
  const [creating, setCreating] = useState(false);
  const [newRoleId, setNewRoleId] = useState("");
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const [voiceFor, setVoiceFor] = useState<string | null>(null);
  const voices = useVoiceCatalog();
  /** 立绘目录 → 文件（`sprites/<id>` → 差分文件名）：缩略图、差分条与「管理立绘」的入口靠它。 */
  const [sprites, setSprites] = useState<Record<string, string[]>>({});
  /** 点开的那张立绘（看大图）。 */
  const [zoom, setZoom] = useState<{ url: string; name: string } | null>(null);

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setRoles(rolesOf(d));
      })
      .catch((e: Error) => setError(e.message));
  }, [playId]);
  useEffect(reload, [reload, revision]);

  const reloadSprites = useCallback((): void => {
    api.listAssets(playId).then(setSprites).catch(() => {});
  }, [playId]);
  useEffect(reloadSprites, [reloadSprites, revision]);
  // 素材到货：助手/舞台那边刚导进来或画出来的立绘，缩略图当场就能看见（切页才更新等于没更新）
  useEffect(() => subscribeAssetReady?.(() => reloadSprites()), [subscribeAssetReady, reloadSprites]);

  /**
   * 一个角色的立绘目录：卡上显式绑定优先，没写就是同名（`spriteIdOf` 是唯一解析口）。
   * 立绘与角色卡是两张各自可选的附件，所以它有图才有缩略图；没图的角色仍显示原来那枚图标。
   */
  const dirOf = (role: Role): string => spriteIdOf(role.id, role);

  const variantsOf = (dir: string): string[] => sprites[`sprites/${dir}`] ?? [];

  const spriteThumb = (dir: string): string | null => {
    const files = variantsOf(dir);
    const pick = files.find((f) => f.replace(/\.\w+$/, "") === "neutral") ?? files[0];
    return pick ? assetUrl(playId, `sprites/${dir}`, pick) : null;
  };

  /** 剧目里现有的立绘目录（绑定下拉的候选）。 */
  const spriteDirs = useMemo(
    () =>
      Object.keys(sprites)
        .filter((key) => key.startsWith("sprites/"))
        .map((key) => key.slice("sprites/".length))
        .sort(),
    [sprites],
  );

  /** 角色卡的编辑走这里：只改内存，保存时才落盘。 */
  const patchRole = (id: string, fn: (doc: Role) => void): void => {
    setRoles(
      (prev) =>
        prev?.map((role) => {
          if (role.id !== id) return role;
          const doc = structuredClone(role);
          fn(doc);
          return doc;
        }) ?? null,
    );
    setDirtyRoles((prev) => new Set(prev).add(id));
    setSaved(false);
  };

  const saveCards = (): void => {
    if (!roles) return;
    // 角色卡按脏标记逐个落盘；写失败整体报错、脏标记留着可重试
    const writes = [...dirtyRoles]
      .map((id) => roles.find((r) => r.id === id))
      .filter((r): r is Role => r !== undefined)
      .map((r) => api.saveFile(playId, characterCardPath(r.id), serializeCharacterCard(r)));
    Promise.all(writes)
      .then(() => {
        setDirtyRoles(new Set());
        setSaved(true);
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  /** 导入 / 新建之后把焦点挪到落点：从资源库导入完还停在旧卡上，等于没导入。 */
  const focus = (id: string): void => {
    setOpen(id);
    reload();
  };

  /**
   * 新建角色：id 由用户指定（它同时是角色卡文件名与立绘目录名，落盘后改不了），
   * 所以先收 id 再进 state——不再自动取 `charN`，那串机器名用户看不出该填什么。
   * 只进 state，保存时才落成那一张 md（play.json 不再参与）。
   */
  const addRole = (): void => {
    if (!roles) return;
    const id = newRoleId.trim();
    if (!/^[\w-]+$/.test(id)) {
      setError("角色 id 仅允许字母数字与 _-");
      return;
    }
    if (roles.some((r) => r.id === id)) {
      setError(`角色 id「${id}」已被占用`);
      return;
    }
    setError(null);
    setRoles([...roles, { id, name: "新角色", body: "" }]);
    setDirtyRoles((prev) => new Set(prev).add(id));
    setOpen(id);
    setCreating(false);
    setNewRoleId("");
  };

  /** 移除角色 = 删那张角色卡，角色本身就在卡里，没有第二处要同步。 */
  const removeRole = (id: string): void => {
    api.deleteFile(playId, characterCardPath(id)).catch((e: Error) => setError(e.message));
    setRoles((prev) => prev?.filter((r) => r.id !== id) ?? null);
    setDirtyRoles((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setOpen(PROTAGONIST_ID);
  };

  if (!roles) return <div className="workshop-tab-pane">读取中…</div>;

  // 选中的那张一定在（主角卡在上面兜过底），兜底的 `roles[0]` 只防空卡目录
  const activeRole = roles.find((r) => r.id === open) ?? roles[0] ?? null;
  const dirty = dirtyRoles.size > 0;
  /** 选中的角色用哪一套立绘（绑定优先、缺省同名）。 */
  const activeDir = activeRole ? dirOf(activeRole) : "";
  /**
   * 下拉的当前值：与角色同名（含手写的 `sprite: <自己的 id>` 那种卡）一律落在第一项——
   * 同名目录写与不写是同一件事，摆两个都能选「mio」的选项只会让人猜。
   */
  const boundValue = activeRole?.sprite && activeRole.sprite !== activeRole.id ? activeRole.sprite : "";
  /** 绑定下拉的候选：剧目里现有的目录 ∪ 当前绑定值（可能还没建、刚改成它）；同名那条由第一项代表。 */
  const bindChoices = [...new Set([...spriteDirs, ...(boundValue ? [boundValue] : [])])]
    .filter((dir) => dir !== activeRole?.id)
    .sort();
  /** 这个目录已经被谁用了：两个角色指向同一套立绘是合法的（同一人的两种身份），但选之前得看得见。 */
  const dirOwnerHint = (dir: string): string => {
    const owner = roles.find((r) => r.id !== activeRole?.id && dirOf(r) === dir);
    return owner ? `（${owner.name || owner.id} 在用）` : "";
  };

  return (
    <div className="workshop-tab-pane setting-cards-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="setting-cards">
        {roles.map((role) => {
          const sprite = spriteThumb(dirOf(role));
          return (
            <button
              key={role.id}
              type="button"
              className={`setting-card${activeRole?.id === role.id ? " active" : ""}`}
              onClick={() => setOpen(role.id)}
            >
              {sprite ? (
                <img className="setting-card-thumb" src={sprite} alt="" />
              ) : (
                <Icon name="users" size={14} />
              )}
              <span className="setting-card-title">{role.name || role.id}</span>
              <span className="setting-card-summary">
                {isProtagonist(role.id) ? "玩家扮演" : role.body || "（还没写性格）"}
              </span>
            </button>
          );
        })}
        {/* 加人也是这个网格里的一件事：入口摆在人旁边，而不是滚到底部那个角落 */}
        <button
          type="button"
          className="setting-card add"
          onClick={() => setLibraryInto("")}
          title="从资源库导入角色卡与立绘"
        >
          <Icon name="download" size={14} />
          <span className="setting-card-title">从资源库导入</span>
          <span className="setting-card-summary">复制现成的角色卡与立绘</span>
        </button>
        <button type="button" className="setting-card add" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          <span className="setting-card-title">新建角色</span>
          <span className="setting-card-summary">指定 id，从空白开始写</span>
        </button>
      </div>

      {creating && (
        <div className="create-form">
          <input
            placeholder="角色 id（字母数字_-）"
            value={newRoleId}
            onChange={(e) => setNewRoleId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRole();
            }}
          />
          <span className="row">
            <button className="primary" onClick={addRole}>
              建这个角色
            </button>
            <button
              className="ghost-btn"
              onClick={() => {
                setCreating(false);
                setNewRoleId("");
              }}
            >
              取消
            </button>
          </span>
        </div>
      )}

      {activeRole && (
        <section className="panel">
          {/* 卡级动作在标题行（动的是整张卡）；字段级的东西在下面的编辑器里 */}
          <div className="assets-section-head">
            <h3>{isProtagonist(activeRole.id) ? "主角卡（玩家扮演）" : "角色卡"}</h3>
            <button
              className="ghost-btn"
              onClick={() =>
                setLibraryInto(isProtagonist(activeRole.id) ? PROTAGONIST_ID : activeRole.id)
              }
              title="从资源库导入一个角色的角色卡与立绘（落在条目对应的角色卡上，不是填这一张）"
            >
              <span className="btn-icon">
                <Icon name="download" size={13} /> 从资源库导入
              </span>
            </button>
            {!isProtagonist(activeRole.id) && (
              <button className="link-btn" onClick={() => removeRole(activeRole.id)}>
                移除角色
              </button>
            )}
          </div>

          {/* 立绘与它的入口同一层，摆在名字上面：这一页第一眼要看的就是这个人长什么样 */}
          <div className="sprite-row">
            {variantsOf(activeDir).length > 0 ? (
              <div className="sprite-peek">
                {variantsOf(activeDir).map((name) => {
                  const url = assetUrl(playId, `sprites/${activeDir}`, name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className="sprite-peek-item"
                      title="看大图"
                      onClick={() => setZoom({ url, name: `${activeDir}/${name}` })}
                    >
                      <img src={url} alt="" />
                      <span>{name.replace(/\.\w+$/, "")}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="muted small">还没有立绘</span>
            )}
            {onManageSprites && (
              <button
                className="ghost-btn"
                title="这个角色的立绘：差分、生成、上传都在素材页"
                onClick={() => onManageSprites(activeDir)}
              >
                <span className="btn-icon">
                  <Icon name="assets" size={13} /> {variantsOf(activeDir).length > 0 ? "管理立绘" : "创建立绘"}
                </span>
              </button>
            )}
          </div>

          {/* 用哪一套立绘写在卡上（`sprite:`）：不写就是与角色同名，这一行就是「显式绑定」的落点 */}
          <label className="sprite-bind">
            <span>立绘目录</span>
            <select
              value={boundValue}
              onChange={(e) =>
                patchRole(activeRole.id, (d) => {
                  d.sprite = e.target.value === "" ? undefined : e.target.value;
                })
              }
            >
              <option value="">与角色同名（{activeRole.id}）</option>
              {bindChoices.map((dir) => (
                <option key={dir} value={dir}>
                  {dir}
                  {dirOwnerHint(dir)}
                </option>
              ))}
            </select>
            <span className="muted small">
              {boundValue ? `assets/sprites/${activeDir}/` : "不写这一格＝用同名目录"}
            </span>
          </label>

          <CharacterEditor
            playId={playId}
            charId={activeRole.id}
            doc={activeRole}
            voices={voices}
            onPickVoice={() => setVoiceFor(activeRole.id)}
            onDocChange={(fn) => patchRole(activeRole.id, fn)}
          />
        </section>
      )}

      {activeRole && (
        <p className="row">
          <button className="primary" onClick={saveCards} disabled={!dirty}>
            保存
          </button>
          {saved && !dirty && <span className="muted small">已保存</span>}
        </p>
      )}

      {zoom && (
        <ImageLightbox
          images={[{ url: zoom.url, caption: zoom.name }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setZoom(null)}
        />
      )}
      {libraryInto !== null && detail && (
        <LibraryBrowser
          playId={playId}
          imported={(kind, id) =>
            kind === "characters"
              ? libraryInto === PROTAGONIST_ID
                ? roles.some((r) => isProtagonist(r.id))
                : roles.some((r) => r.id === id)
              : false
          }
          onClose={() => setLibraryInto(null)}
          onImported={(r) => focus(r.characters[0] ?? libraryInto)}
          {...(libraryInto === PROTAGONIST_ID
            ? {
                target: "protagonist" as const,
                title: "从资源库导入主角卡",
              }
            : {})}
          only="characters"
        />
      )}
      {voiceFor !== null && (
        <VoiceLibrary
          playId={playId}
          voices={voices}
          onClose={() => setVoiceFor(null)}
          onPick={(entry) => {
            // 选音色连人话描述一起写进角色卡（play.json 的 voice/voiceId 不再写）
            patchRole(voiceFor, (doc) => {
              doc.voiceId = entry.id;
              doc.voice = entry.title;
            });
            setVoiceFor(null);
          }}
        />
      )}
    </div>
  );
}
