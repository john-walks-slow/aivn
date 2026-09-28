import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterCard, PlayConfig } from "@stage-ai/core";
import { VOICE_PRESETS } from "@stage-ai/core";
import { api, type PlayDetail } from "../api.js";
import { navigate } from "../router.jsx";

const KINDS = ["backgrounds", "cg", "sfx", "bgm"] as const;

/** 素材与配置页：premise/角色卡编辑 + 素材上传管理 + 就绪门实时反馈。 */
export function AssetsView({ playId }: { playId: string }) {
  const [detail, setDetail] = useState<PlayDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [spriteChar, setSpriteChar] = useState("");

  const reload = useCallback((): void => {
    api
      .playDetail(playId)
      .then((d) => {
        setDetail(d);
        setDraft(d.play);
      })
      .catch((e: Error) => setError(e.message));
    api.listAssets(playId).then(setAssets).catch(() => {});
  }, [playId]);
  useEffect(reload, [reload]);

  const patch = (fn: (play: PlayConfig) => void): void => {
    if (!draft) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setSaved(false);
  };

  const save = (): void => {
    if (!draft) return;
    api
      .savePlay(draft)
      .then(() => {
        setSaved(true);
        reload();
      })
      .catch((e: Error) => setError(e.message));
  };

  const upload = (kind: string, file: File): void => {
    api
      .uploadAsset(playId, kind, file.name, file)
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const remove = (kind: string, name: string): void => {
    if (!window.confirm(`删除 ${kind}/${name}？`)) return;
    api
      .deleteAsset(playId, kind, name)
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const readiness = detail?.readiness;
  const spritesDirs = Object.keys(assets).filter((k) => k.startsWith("sprites/"));

  return (
    <div className="screen assets-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate(`/play/${playId}`)}>
          ← 标题
        </button>
        <h2>素材与配置</h2>
        {readiness && (
          <span className={`badge ${readiness.ready ? "ok" : "warn"}`}>
            {readiness.ready ? "就绪门：可开演" : "就绪门：未就绪"}
          </span>
        )}
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {draft && (
        <section className="panel">
          <h3>剧目配置（play.json）</h3>
          <label className="field">
            <span>标题</span>
            <input value={draft.title} onChange={(e) => patch((p) => (p.title = e.target.value))} />
          </label>
          <label className="field">
            <span>premise（世界与人物设定）</span>
            <textarea
              rows={4}
              value={draft.premise}
              onChange={(e) => patch((p) => (p.premise = e.target.value))}
            />
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
              <option value="zh">中文（zh）</option>
              <option value="ja">日本語（ja）</option>
              <option value="en">English（en）</option>
              <option value="ko">한국어（ko）</option>
            </select>
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
            <p className="muted small">留空则「✨ 润色」走通用模式（只修顺语句，不改口吻）。</p>
          </div>

          <h3>角色卡</h3>
          {draft.characters.map((char, i) => (
            <CharacterEditor
              key={char.id}
              playId={playId}
              char={char}
              files={assets[`sprites/${char.id}`] ?? []}
              onChange={(fn) => patch((p) => fn(p.characters[i]!))}
              onRemove={() => patch((p) => p.characters.splice(i, 1))}
            />
          ))}
          <button
            className="ghost-btn"
            onClick={() =>
              patch((p) => {
                const id = `char${p.characters.length + 1}`;
                p.characters.push({ id, name: "新角色", persona: "", sprites: {} });
              })
            }
          >
            ＋ 添加角色
          </button>

          <p className="row">
            <button className="primary" onClick={save}>
              保存配置
            </button>
            {saved && <span className="muted small">已保存</span>}
          </p>
        </section>
      )}

      <section className="panel">
        <h3>素材</h3>
        <div className="upload-grid">
          {KINDS.map((kind) => (
            <div key={kind} className="upload-cell">
              <strong>{kind}</strong>
              <label className="btn-as-label small">
                上传
                <input
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(kind, file);
                  }}
                />
              </label>
              <ul className="asset-list">
                {(assets[kind] ?? []).map((name) => (
                  <li key={name}>
                    <span>{name}</span>
                    <button className="link-btn" onClick={() => remove(kind, name)}>
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="upload-cell">
            <strong>sprites/&lt;角色id&gt;</strong>
            <span className="row small">
              <input
                placeholder="角色 id"
                value={spriteChar}
                onChange={(e) => setSpriteChar(e.target.value)}
                className="small-input"
              />
              <label className="btn-as-label small">
                上传立绘
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && spriteChar.trim()) upload(`sprites/${spriteChar.trim()}`, file);
                  }}
                />
              </label>
            </span>
            {spritesDirs.map((dir) => (
              <ul key={dir} className="asset-list">
                {(assets[dir] ?? []).map((name) => (
                  <li key={name}>
                    <span>
                      {dir}/{name}
                    </span>
                    <button className="link-btn" onClick={() => remove(dir, name)}>
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/** 差分映射编辑行（本地稳定 id，避免以可变 expression 作 key 导致每击键重挂载失焦）。 */
interface SpriteRow {
  id: number;
  expression: string;
  file: string;
}

function CharacterEditor({
  playId,
  char,
  files,
  onChange,
  onRemove,
}: {
  playId: string;
  char: CharacterCard;
  files: string[];
  onChange: (fn: (char: CharacterCard) => void) => void;
  onRemove: () => void;
}) {
  const nextId = useRef(0);
  const [previewing, setPreviewing] = useState(false);
  // 行状态挂载时从角色卡初始化；编辑期以本地行为准，blur/离散操作时提交回角色卡
  const [rows, setRows] = useState<SpriteRow[]>(() =>
    Object.entries(char.sprites ?? {}).map(([expression, file]) => ({
      id: nextId.current++,
      expression,
      file,
    })),
  );

  /** 音色试听：服务端合成固定样本 → 播放（预置二次元音色库）。 */
  const previewVoice = (): void => {
    if (!char.voiceId || previewing) return;
    setPreviewing(true);
    api
      .ttsPreview(playId, char.voiceId)
      .then(({ url }) => {
        void new Audio(url).play().catch(() => {});
      })
      .catch((e: Error) => window.alert(`试听失败：${e.message}`))
      .finally(() => setPreviewing(false));
  };

  const commit = (source: SpriteRow[]): void => {
    onChange((c) => {
      c.sprites = Object.fromEntries(
        source.filter((r) => r.expression.trim() !== "").map((r) => [r.expression.trim(), r.file]),
      );
    });
  };

  const setFile = (id: number, file: string): void => {
    const next = rows.map((r) => (r.id === id ? { ...r, file } : r));
    setRows(next);
    commit(next);
  };

  const dropRow = (id: number): void => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    commit(next);
  };

  const addRow = (): void => {
    setRows((prev) => [...prev, { id: nextId.current++, expression: "", file: files[0] ?? "" }]);
  };

  return (
    <div className="char-card">
      <div className="row">
        <input value={char.name} onChange={(e) => onChange((c) => (c.name = e.target.value))} />
        <button className="link-btn" onClick={onRemove}>
          移除角色
        </button>
      </div>
      <textarea
        rows={2}
        placeholder="persona（性格与背景）"
        value={char.persona}
        onChange={(e) => onChange((c) => (c.persona = e.target.value))}
      />
      <div className="voice-row">
        <select
          value={char.voiceId ?? ""}
          onChange={(e) => onChange((c) => (c.voiceId = e.target.value || undefined))}
        >
          <option value="">音色：未设置（不配音）</option>
          {VOICE_PRESETS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}（{v.tone}）
            </option>
          ))}
          {char.voiceId && !VOICE_PRESETS.some((v) => v.id === char.voiceId) && (
            <option value={char.voiceId}>自定义 {char.voiceId.slice(0, 8)}…</option>
          )}
        </select>
        <button className="ghost-btn" disabled={!char.voiceId || previewing} onClick={previewVoice}>
          {previewing ? "合成中…" : "试听"}
        </button>
      </div>
      <p className="muted small">立绘差分映射（expression → 文件）——差分文件需先上传到 sprites/{char.id}/</p>
      {rows.map((row) => (
        <div key={row.id} className="row small">
          <input
            className="small-input"
            value={row.expression}
            autoFocus={row.expression === ""}
            onChange={(e) =>
              setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, expression: e.target.value } : r)))
            }
            onBlur={() => commit(rows)}
          />
          <select value={row.file} onChange={(e) => setFile(row.id, e.target.value)}>
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button className="link-btn" onClick={() => dropRow(row.id)}>
            删
          </button>
        </div>
      ))}
      <div className="row small">
        <button className="ghost-btn" onClick={addRow}>
          ＋ 添加映射
        </button>
      </div>
    </div>
  );
}
