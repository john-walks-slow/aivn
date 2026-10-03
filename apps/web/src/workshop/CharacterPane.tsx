import { useCallback, useEffect, useState } from "react";
import { characterCardPath, isProtagonist, PROTAGONIST_ID, serializeCharacterCard } from "@stage-ai/core";
import type { CharacterDocument } from "@stage-ai/core";
import { api, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { CharacterEditor } from "./CharacterEditor.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { ImageGenDialog, type ImageGenTarget } from "./ImageGenDialog.js";
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
  subscribeImageResult,
}: {
  playId: string;
  revision: number;
  subscribeImageResult?: (handler: (res: any) => void) => () => void;
}) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  /** 改过的角色卡：保存时只写这些，没动过的卡不必为刷新 mtime 而重写一遍。 */
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string>(PROTAGONIST_ID);
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const [voiceFor, setVoiceFor] = useState<string | null>(null);
  const [genTarget, setGenTarget] = useState<ImageGenTarget | null>(null);
  const voices = useVoiceCatalog();

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setRoles(rolesOf(d));
      })
      .catch((e: Error) => setError(e.message));
    api.listAssets(playId).then(setAssets).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload, revision]);

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

  const addRole = (): void => {
    if (!roles) return;
    const taken = new Set(roles.map((r) => r.id));
    let n = roles.length + 1;
    while (taken.has(`char${n}`)) n++;
    const id = `char${n}`;
    // 角色表就是角色卡目录：新建只进 state，保存时才落成那一张 md（play.json 不再参与）
    setRoles([...roles, { id, name: "新角色", body: "" }]);
    setDirtyRoles((prev) => new Set(prev).add(id));
    setOpen(id);
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

  return (
    <div className="workshop-tab-pane setting-cards-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="setting-cards">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            className={`setting-card${activeRole?.id === role.id ? " active" : ""}`}
            onClick={() => setOpen(role.id)}
          >
            <Icon name="users" size={14} />
            <span className="setting-card-title">{role.name || role.id}</span>
            <span className="setting-card-summary">
              {isProtagonist(role.id) ? "玩家扮演" : role.body || "（还没写性格）"}
            </span>
          </button>
        ))}
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
        <button type="button" className="setting-card add" onClick={addRole}>
          <Icon name="plus" size={14} />
          <span className="setting-card-title">新建角色</span>
          <span className="setting-card-summary">从空白开始写</span>
        </button>
      </div>

      {activeRole && (
        <section className="panel">
          <h3>{isProtagonist(activeRole.id) ? "主角卡（玩家扮演）" : "角色卡"}</h3>
          <CharacterEditor
            playId={playId}
            charId={activeRole.id}
            doc={activeRole}
            files={assets[`sprites/${activeRole.id}`] ?? []}
            voices={voices}
            onPickVoice={() => setVoiceFor(activeRole.id)}
            // 主角那份导入落固定 id 的卡（连立绘一起），普通角色按条目 id 建卡
            onBrowseLibrary={() =>
              setLibraryInto(isProtagonist(activeRole.id) ? PROTAGONIST_ID : activeRole.id)
            }
            onUploadSprite={(file) =>
              api
                .uploadAsset(playId, `sprites/${activeRole.id}`, file.name, file)
                .then(reload)
                .catch((e: Error) => setError(e.message))
            }
            onGenerateSprite={(opts) =>
              setGenTarget({
                kind: "sprite",
                characterId: activeRole.id,
                characterName: activeRole.name ?? activeRole.id,
                initialExpression: opts.expression,
                initialFraming: opts.framing,
                fixedExpression: opts.fixed,
              })
            }
            onDocChange={(fn) => patchRole(activeRole.id, fn)}
            {...(isProtagonist(activeRole.id) ? {} : { onRemove: () => removeRole(activeRole.id) })}
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
      {genTarget !== null && (
        <ImageGenDialog
          playId={playId}
          target={genTarget}
          subscribeImageResult={subscribeImageResult}
          onClose={() => setGenTarget(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}
