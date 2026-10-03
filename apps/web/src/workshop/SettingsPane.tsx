import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlayConfig, PlayCover } from "@aivn/core";
import { languageLabel, LANGUAGE_LABELS } from "@aivn/core";
import { api, assetUrl, type PlayFile } from "../api.js";
import { Icon, type IconName } from "../ui/Icon.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog } from "../voice/useVoiceCatalog.js";

const CRAFT_PATH = "memory/always/craft.md";
const PREMISE_PATH = "memory/always/premise.md";

/** 一张设定卡。kind 决定展开区渲染哪个编辑器，不决定它长什么样。 */
type Card =
  | { key: string; kind: "play"; icon: IconName; title: string; summary: string }
  | { key: string; kind: "file"; icon: IconName; title: string; summary: string; path: string; readOnly: boolean };

/**
 * 设定与记忆：一张剧目的全部「写下来的东西」都在这一页——
 * 剧目字段、世界与人物设定、创作口径、主角与角色卡、设定卡。
 *
 * 摆成卡片而不是文件列表：这些不是「文件」，是作者逐条在维护的设定条目。
 * 列表 + 侧栏那套布局和「文件」页没有区别，等于给同一件事两个入口。
 */
export function SettingsPane({ playId, revision }: { playId: string; revision: number }) {
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [files, setFiles] = useState<PlayFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(PREMISE_PATH);
  /** 记忆卡的本地正文：只在打开某一张时拉，避免为每张都占一份 state。 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 可当封面的图：剧目自己的背景与插图。 */
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  /** 音色库面板开着时为 true；剧目级兜底音色只在这一处选。 */
  const [pickingVoice, setPickingVoice] = useState(false);
  const voices = useVoiceCatalog();

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => setDraft(d.play))
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
    return out;
  }, [files, draft]);

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
              <p className="muted small">音色需支持该语言。</p>
            </label>
            <div className="field">
              <span>无名角色音色（路人、临时角色）</span>
              <div className="row">
                <button type="button" className="btn-icon" onClick={() => setPickingVoice(true)}>
                  <Icon name="volume" />
                  {draft.defaultVoiceId ? "换一个音色" : "挑一个音色"}
                </button>
                {draft.defaultVoiceId && (
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => patch((p) => delete p.defaultVoiceId)}
                  >
                    清空
                  </button>
                )}
              </div>
              <p className="muted small">
                没有角色卡的一次性角色（<code>{'<say id="passerby">'}</code>）默认不出声，这里挑一个兜底。
              </p>
            </div>
            <CoverPicker
              playId={playId}
              assets={assets}
              current={draft.cover}
              onPick={(cover) => patch((p) => (p.cover = cover))}
              onClear={() => patch((p) => delete p.cover)}
            />
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
              placeholder={HINTS[active.path] ?? ""}
            />
          </>
        ) : null}

        {active !== null && active.kind !== "file" && (
          <p className="row">
            <button className="primary" onClick={savePlay}>
              保存
            </button>
            {saved && <span className="muted small">已保存</span>}
          </p>
        )}

      </section>

      {pickingVoice && (
        <VoiceLibrary
          playId={playId}
          voices={voices}
          onClose={() => setPickingVoice(false)}
          onPick={(entry) => {
            patch((p) => (p.defaultVoiceId = entry.id));
            setPickingVoice(false);
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

/**
 * 两份常驻设定的空态提示。
 *
 * 新剧目这两份是空的。「该怎么写」的话一旦存进文件就成了设定的一部分，剧作家会当成人写的
 * 内容照读（写作指引混进设定，是模板化剧目的起点），所以引导只留在占位符里：
 * 看得见、存不进去、不进模型。
 */
const HINTS: Record<string, string> = {
  [PREMISE_PATH]:
    "世界在哪儿、什么年代、什么规矩；主要人物是谁、彼此什么关系。\n留空也能开演，剧作家会自己发挥。",
  [CRAFT_PATH]: "这部剧的台词口径：节奏多密、情绪怎么落地、有什么禁项。\n留空则剧作家没有口径可依，一切自己判断。",
};

/**
 * 封面：从剧目已有的背景与插图里挑一张，不另存文件。
 *
 * 没指定时剧目库与标题画面按「第一张背景 → 第一张插图」自动取，所以「清除」不是把封面
 * 清成空白，而是交还给自动挑的那张。
 */
function CoverPicker({
  playId,
  assets,
  current,
  onPick,
  onClear,
}: {
  playId: string;
  assets: Record<string, string[]>;
  current: PlayCover | undefined;
  onPick: (cover: PlayCover) => void;
  onClear: () => void;
}) {
  const images: PlayCover[] = [
    ...(assets.backgrounds ?? []).map((id) => ({ kind: "backgrounds", id }) as PlayCover),
    ...(assets.cg ?? []).map((id) => ({ kind: "cg", id }) as PlayCover),
  ];
  return (
    <div className="field">
      <span>封面</span>
      {images.length === 0 ? (
        <p className="muted small">还没有背景或插图可当封面。</p>
      ) : (
        <>
          <div className="cover-picker">
            {images.map((img) => (
              <button
                key={`${img.kind}/${img.id}`}
                type="button"
                className={`cover-pick${current?.kind === img.kind && current.id === img.id ? " on" : ""}`}
                onClick={() => onPick(img)}
                title={img.id}
              >
                <img src={assetUrl(playId, img.kind, img.id)} alt={img.id} loading="lazy" />
              </button>
            ))}
          </div>
          <p className="row">
            <button className="ghost-btn" onClick={onClear} disabled={!current}>
              恢复自动挑选
            </button>
            <span className="muted small">
              {current ? current.id : "自动：背景里挑第一张，没有就用插图里的第一张"}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/** 记忆卡所属的组（卡片副标题）：常驻设定先摆，因为它每轮都注入。 */
function rankOf(key: string): number {
  if (key === "play") return -1;
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
  placeholder,
  onChange,
  onSave,
  onDirty,
}: {
  path: string;
  value: string;
  readOnly: boolean;
  /** 空态提示（只给两份常驻设定，其余记忆卡没有）。 */
  placeholder?: string;
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
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {!readOnly && (
        <p className="row">
          <button className="primary" disabled={!dirty} onClick={onSave}>
            保存
          </button>
        </p>
      )}
    </>
  );
}