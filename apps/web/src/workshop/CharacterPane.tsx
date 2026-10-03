import { useCallback, useEffect, useState } from "react";
import { serializeCharacterCard } from "@stage-ai/core";
import type { CharacterDocument, PlayConfig } from "@stage-ai/core";
import { api, type PlayDetail } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { CharacterEditor } from "./CharacterEditor.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { ImageGenDialog, type ImageGenTarget } from "./ImageGenDialog.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog } from "../voice/useVoiceCatalog.js";

const PROTAGONIST_KEY = "protagonist";
const CHARACTER_DIR = "memory/always/characters/";

/** 角色卡的路径（工坊这边拼的唯一一份，与服务端 memory.ts 读同一处）。 */
function characterCardPath(id: string): string {
  return `${CHARACTER_DIR}${id}.md`;
}

/** cast 里每个角色都有 id（服务端按文件名取的），这里只是把可选字段收成必填。 */
type Role = CharacterDocument & { id: string };

/** cast 是服务端解析好的整份角色卡，没有 id 的条目（理论上不存在）直接丢掉。 */
function rolesOf(detail: PlayDetail): Role[] {
  return detail.cast.filter((doc): doc is Role => Boolean(doc.id));
}

/**
 * 角色：主角卡与全部角色卡。角色的真相源是 `memory/always/characters/<id>.md`，
 * 主角卡例外——玩家不上台，它的 persona 走 play.json 的 `protagonist` 字段。
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
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  /** 改过的角色卡：保存时只写这些，没动过的卡不必为刷新 mtime 而重写一遍。 */
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(PROTAGONIST_KEY);
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const [voiceFor, setVoiceFor] = useState<string | null>(null);
  const [genTarget, setGenTarget] = useState<ImageGenTarget | null>(null);
  const voices = useVoiceCatalog();

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setDraft(d.play);
        setRoles(rolesOf(d));
      })
      .catch((e: Error) => setError(e.message));
    api.listAssets(playId).then(setAssets).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload, revision]);

  const patch = (fn: (play: PlayConfig) => void): void => {
    if (!draft) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setSaved(false);
  };

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

  const savePlay = (): void => {
    if (!draft || !roles) return;
    // 角色卡与 play.json 在同一个保存动作里落盘；卡片写失败整体报错、脏标记留着可重试
    const cardWrites = [...dirtyRoles]
      .map((id) => roles.find((r) => r.id === id))
      .filter((r): r is Role => r !== undefined)
      .map((r) => api.saveFile(playId, characterCardPath(r.id), serializeCharacterCard(r)));
    Promise.all([api.savePlay(draft), ...cardWrites])
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
    setOpen(`char:${id}`);
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
    setOpen(PROTAGONIST_KEY);
  };

  if (!draft || !roles) return <div className="workshop-tab-pane">读取中…</div>;

  const active = open === PROTAGONIST_KEY ? PROTAGONIST_KEY : open?.replace(/^char:/, "") ?? "";
  const activeIndex = roles.findIndex((r) => r.id === active);
  const activeRole = activeIndex >= 0 ? (roles[activeIndex] as Role) : null;

  return (
    <div className="workshop-tab-pane setting-cards-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="setting-cards">
        <button
          type="button"
          className={`setting-card${open === PROTAGONIST_KEY ? " active" : ""}`}
          onClick={() => setOpen(PROTAGONIST_KEY)}
        >
          <Icon name="users" size={14} />
          <span className="setting-card-title">主角</span>
          <span className="setting-card-summary">
            {draft.protagonist?.name || "（玩家，上台的是别人）"}
          </span>
        </button>
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            className={`setting-card${open === `char:${role.id}` ? " active" : ""}`}
            onClick={() => setOpen(`char:${role.id}`)}
          >
            <Icon name="users" size={14} />
            <span className="setting-card-title">{role.name || role.id}</span>
            <span className="setting-card-summary">{role.body || "（还没写性格）"}</span>
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

      {active === PROTAGONIST_KEY ? (
        <section className="panel">
          <h3>主角卡（玩家）</h3>
          <p className="muted small">玩家自己，不上台，没有立绘和音色。</p>
          <div className="char-card">
            <div className="row">
              <input
                placeholder="主角名（如：你 / 转学生）"
                value={draft.protagonist?.name ?? ""}
                onChange={(e) =>
                  patch((p) => (p.protagonist = { name: e.target.value, persona: p.protagonist?.persona ?? "" }))
                }
              />
            </div>
            <div className="row small">
              <button className="ghost-btn" onClick={() => setLibraryInto(PROTAGONIST_KEY)}>
                <span className="btn-icon">
                  <Icon name="download" size={13} /> 从资源库导入主角卡
                </span>
              </button>
            </div>
            <textarea
              rows={4}
              placeholder="persona（性格与说话风格——输入润色的口吻依据）"
              value={draft.protagonist?.persona ?? ""}
              onChange={(e) =>
                patch((p) => (p.protagonist = { name: p.protagonist?.name ?? "", persona: e.target.value }))
              }
            />
          </div>
        </section>
      ) : activeRole ? (
        <section className="panel">
          <h3>角色卡</h3>
          <CharacterEditor
            playId={playId}
            charId={activeRole.id}
            doc={activeRole}
            files={assets[`sprites/${activeRole.id}`] ?? []}
            voices={voices}
            onPickVoice={() => setVoiceFor(activeRole.id)}
            onBrowseLibrary={() => setLibraryInto(activeRole.id)}
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
            onRemove={() => removeRole(activeRole.id)}
          />
        </section>
      ) : null}

      {detail && (active === PROTAGONIST_KEY || activeRole) && (
        <p className="row">
          <button className="primary" onClick={savePlay}>
            保存
          </button>
          {saved && <span className="muted small">已保存</span>}
        </p>
      )}
      {libraryInto !== null && detail && (
        <LibraryBrowser
          playId={playId}
          imported={(kind, id) =>
            kind === "characters"
              ? libraryInto === PROTAGONIST_KEY
                ? Boolean(detail.play.protagonist?.name || detail.play.protagonist?.persona)
                : roles.some((r) => r.id === id)
              : false
          }
          onClose={() => setLibraryInto(null)}
          onImported={(r) => focus(r.protagonist ? PROTAGONIST_KEY : `char:${r.characters[0] ?? libraryInto}`)}
          {...(libraryInto === PROTAGONIST_KEY
            ? {
                target: "protagonist" as const,
                title: "从资源库导入主角卡",
              }
            : {})}
          only="characters"
        />
      )}
      {voiceFor !== null && draft && (
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