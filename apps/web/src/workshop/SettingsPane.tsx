import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterCard, PlayConfig } from "@stage-ai/core";
import { languageLabel, LANGUAGE_LABELS } from "@stage-ai/core";
import { api, type PlayDetail, type PlayFile } from "../api.js";
import { Icon, type IconName } from "../ui/Icon.js";
import { CharacterEditor } from "./CharacterEditor.js";
import { LibraryBrowser } from "./LibraryBrowser.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog } from "../voice/useVoiceCatalog.js";

const CRAFT_PATH = "memory/always/craft.md";
const PREMISE_PATH = "memory/always/premise.md";

/** 一张设定卡。kind 决定展开区渲染哪个编辑器，不决定它长什么样。 */
type Card =
  | { key: string; kind: "play"; icon: IconName; title: string; summary: string }
  | { key: string; kind: "file"; icon: IconName; title: string; summary: string; path: string; readOnly: boolean }
  | { key: string; kind: "character"; icon: IconName; title: string; summary: string; index: number };

/**
 * 设定与记忆：一张剧目的全部「写下来的东西」都在这一页——
 * 剧目字段、世界与人物设定、创作口径、主角与角色卡、设定卡。
 *
 * 摆成卡片而不是文件列表：这些不是「文件」，是作者逐条在维护的设定条目。
 * 列表 + 侧栏那套布局和「文件」页没有区别，等于给同一件事两个入口。
 */
export function SettingsPane({ playId, revision }: { playId: string; revision: number }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [files, setFiles] = useState<PlayFile[]>([]);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(PREMISE_PATH);
  /** 记忆卡的本地正文：只在打开某一张时拉，避免为每张都占一份 state。 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [libraryInto, setLibraryInto] = useState<string | null>(null);
  const [libraryChar, setLibraryChar] = useState<number | null>(null);
  const voices = useVoiceCatalog();

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setDraft(d.play);
      })
      .catch((e: Error) => setError(e.message));
    api.listFiles(playId).then(setFiles).catch(() => {});
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

  const savePlay = (): void => {
    if (!draft) return;
    api
      .savePlay(draft)
      .then(() => {
        setSaved(true);
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  /** 展开哪张就现拉哪张：不为每张记忆卡常驻一份正文。 */
  useEffect(() => {
    if (!open?.startsWith("memory/")) return;
    let alive = true;
    const read = open === CRAFT_PATH ? api.craft(playId) : api.readFile(playId, open);
    void read
      .then(({ content }) => alive && setDrafts((prev) => ({ ...prev, [open]: content })))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, playId]);

  const saveFile = (path: string): void => {
    const body = drafts[path];
    if (body === undefined) return;
    api
      .saveFile(playId, path, body)
      .then(() => {
        setSaved(true);
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  const cards = useMemo<Card[]>(() => {
    if (!draft) return [];
    const out: Card[] = [
      {
        key: "play",
        kind: "play",
        icon: "settings",
        title: "剧目",
        summary: [draft.title, draft.opening].filter(Boolean).join(" · ") || "（空）",
      },
    ];
    for (const f of files) {
      // 只有剧目记忆进这一页：play.json 走「剧目」卡，纪元产物是机器写的，列出来只会让人以为能改
      if (!f.path.startsWith("memory/")) continue;
      if (f.path.startsWith("memory/arcs/") || f.path.startsWith("memory/archive/")) continue;
      out.push({
        key: f.path,
        kind: "file",
        icon: "memory",
        title: titleOf(f),
        summary: groupOf(f.path),
        path: f.path,
        readOnly: f.writable === false,
      });
    }
    out.sort((a, b) => rankOf(a.key) - rankOf(b.key));
    draft.characters.forEach((c, index) => {
      out.push({
        key: `char:${c.id}`,
        kind: "character",
        icon: "assets",
        title: c.name || c.id,
        summary: c.persona || "（还没写性格）",
        index,
      });
    });
    return out;
  }, [draft, files]);

  if (!draft) return <div className="workshop-tab-pane">读取中…</div>;

  const active = cards.find((c) => c.key === open) ?? null;

  return (
    <div className="workshop-tab-pane setting-cards-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="setting-cards">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`setting-card${open === card.key ? " active" : ""}`}
            onClick={() => setOpen(card.key)}
          >
            <Icon name={card.icon} size={14} />
            <span className="setting-card-title">{card.title}</span>
            <span className="setting-card-summary">{card.summary}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        {active === null ? (
          <p className="muted small">选一张设定卡开始读或改。</p>
        ) : active.kind === "play" ? (
          <>
            <h3>剧目</h3>
            <label className="field">
              <span>标题</span>
              <input value={draft.title} onChange={(e) => patch((p) => (p.title = e.target.value))} />
            </label>
            <label className="field">
              <span>opening（开局指令）</span>
              <textarea
                rows={2}
                value={draft.opening}
                onChange={(e) => patch((p) => (p.opening = e.target.value))}
              />
            </label>
            <label className="field">
              <span>语音语言（say 台词翻译后再送 TTS）</span>
              <select
                value={draft.voiceLanguage ?? ""}
                onChange={(e) => patch((p) => (p.voiceLanguage = e.target.value || undefined))}
              >
                <option value="">跟随剧本语言（不翻译）</option>
                {Object.keys(LANGUAGE_LABELS)
                  .sort()
                  .map((code) => (
                    <option key={code} value={code}>
                      {languageLabel(code)}（{code}）
                    </option>
                  ))}
              </select>
              <p className="muted small">翻译由 LLM 完成，任何小语种都能用——前提是所选音色支持该语言。</p>
            </label>
            <h3>主角卡（玩家）</h3>
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
              <textarea
                rows={2}
                placeholder="persona（性格与说话风格——输入润色的口吻依据）"
                value={draft.protagonist?.persona ?? ""}
                onChange={(e) =>
                  patch((p) => (p.protagonist = { name: p.protagonist?.name ?? "", persona: e.target.value }))
                }
              />
              <div className="row small">
                <button className="ghost-btn" onClick={() => setLibraryInto("protagonist")}>
                  <span className="btn-icon">
                    <Icon name="download" size={13} /> 从资源库导入
                  </span>
                </button>
              </div>
            </div>
          </>
        ) : active.kind === "file" ? (
          <>
            <h3>{active.title}</h3>
            {active.readOnly ? (
              <p className="muted small">
                这份由引擎自动写入，改了会在下一轮被覆盖。去「对话」里让工坊处理。
              </p>
            ) : null}
            <FileEditor
              path={active.path}
              value={drafts[active.path] ?? ""}
              readOnly={active.readOnly}
              onChange={(v) => setDrafts((prev) => ({ ...prev, [active.path]: v }))}
              onSave={() => saveFile(active.path)}
              onDirty={(dirty) => setSaved(!dirty)}
            />
          </>
        ) : (
          <>
            <h3>角色卡</h3>
            <CharacterEditor
              playId={playId}
              char={draft.characters[active.index] as CharacterCard}
              files={assets[`sprites/${draft.characters[active.index]!.id}`] ?? []}
              voices={voices}
              onPickVoice={() => setLibraryChar(active.index)}
              onBrowseLibrary={() => setLibraryInto(draft.characters[active.index]!.id)}
              onUploadSprite={(file) =>
                api
                  .uploadAsset(playId, `sprites/${draft.characters[active.index]!.id}`, file.name, file)
                  .then(reload)
                  .catch((e: Error) => setError(e.message))
              }
              onChange={(fn) => patch((p) => fn(p.characters[active.index]!))}
              onRemove={() => {
                patch((p) => p.characters.splice(active.index, 1));
                setOpen(null);
              }}
            />
          </>
        )}

        {active !== null && active.kind !== "file" && (
          <p className="row">
            <button className="primary" onClick={savePlay}>
              保存
            </button>
            {saved && <span className="muted small">已保存</span>}
          </p>
        )}
      </section>

      {detail && (
        <p className="row">
          <button
            className="ghost-btn"
            onClick={() =>
              patch((p) => {
                p.characters.push({
                  id: `char${p.characters.length + 1}`,
                  name: "新角色",
                  persona: "",
                  sprites: {},
                });
              })
            }
          >
            <span className="btn-icon">
              <Icon name="plus" /> 添加角色
            </span>
          </button>
        </p>
      )}

      {libraryInto !== null && detail && (
        <LibraryBrowser
          playId={playId}
          imported={(kind, id) =>
            kind === "characters"
              ? libraryInto === "protagonist"
                ? Boolean(detail.play.protagonist?.name || detail.play.protagonist?.persona)
                : detail.play.characters.some((c) => c.id === id)
              : false
          }
          onClose={() => setLibraryInto(null)}
          onImported={reload}
          {...(libraryInto === "protagonist"
            ? { target: "protagonist" as const, title: "从资源库导入主角卡" }
            : {})}
        />
      )}
      {libraryChar !== null && draft && (
        <VoiceLibrary
          playId={playId}
          voices={voices}
          onClose={() => setLibraryChar(null)}
          onPick={(entry) => {
            patch((p) => (p.characters[libraryChar]!.voiceId = entry.id));
            setLibraryChar(null);
          }}
        />
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  [PREMISE_PATH]: "世界与人物设定",
  [CRAFT_PATH]: "创作口径",
};

/** 记忆卡所属的组（卡片副标题）：常驻设定先摆，因为它每轮都注入。 */
function rankOf(key: string): number {
  if (key === "play") return -1;
  if (key.startsWith("char:")) return 3;
  if (key.startsWith("memory/always/")) return 0;
  return key.startsWith("memory/index/") ? 1 : 2;
}

function groupOf(path: string): string {
  if (path.startsWith("memory/always/")) return "常驻设定 · 每轮都注入";
  if (path.startsWith("memory/index/")) return "设定卡 · 按需读";
  return "角色设定";
}

/** 记忆卡的标题：两份常驻设定给名字，其余取路径末段；子目录里的卡带目录名以免同名分不清。 */
function titleOf(file: PlayFile): string {
  if (TITLES[file.path]) return TITLES[file.path]!;
  const parts = file.path.split("/");
  const name = (parts.pop() ?? file.path).replace(/\.md$/, "");
  const parent = parts.pop();
  return parent ? `${name}（${parent}）` : name;
}

function FileEditor({
  path,
  value,
  readOnly,
  onChange,
  onSave,
  onDirty,
}: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [original, setOriginal] = useState(value);
  useEffect(() => setOriginal(value), [path, value]);
  const dirty = value !== original;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  return (
    <>
      <textarea
        className="file-body"
        readOnly={readOnly}
        rows={18}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {!readOnly && (
        <p className="row">
          <button className="primary" disabled={!dirty} onClick={onSave}>
            保存
          </button>
          <span className="muted small">{path}</span>
        </p>
      )}
    </>
  );
}