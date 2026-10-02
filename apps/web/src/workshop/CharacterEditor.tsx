import { useEffect, useRef, useState } from "react";
import type { CharacterCard, SpriteFraming } from "@stage-ai/core";
import { SPRITE_FRAMINGS, SPRITE_FRAMING_LABELS } from "@stage-ai/core";
import { api } from "../api.js";
import { Icon } from "../ui/Icon.js";
import type { VoiceCatalogState } from "../voice/useVoiceCatalog.js";

interface SpriteRow {
  id: number;
  expression: string;
  file: string;
  framing: SpriteFraming | "";
}

/** 角色卡：名字 / persona / 音色 / 立绘差分映射。 */
export function CharacterEditor({
  playId,
  char,
  files,
  voices,
  onPickVoice,
  onBrowseLibrary,
  onUploadSprite,
  onChange,
  onRemove,
}: {
  playId: string;
  char: CharacterCard;
  files: string[];
  voices: VoiceCatalogState;
  onPickVoice: () => void;
  onBrowseLibrary: () => void;
  onUploadSprite: (file: File) => void;
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
      framing: char.spriteFraming?.[expression] ?? "",
    })),
  );

  /** 音色试听：服务端合成固定样本 → 播放（Fish 公共库音色，目录内目录外都能试）。 */
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

  // 目录外的 voiceId（demo 剧目的萝莉萌妹等）按 id 单条解析出名字，不装作"未设置"
  const { resolve: resolveVoice } = voices;
  useEffect(() => {
    resolveVoice(char.voiceId);
  }, [resolveVoice, char.voiceId]);

  const commit = (source: SpriteRow[]): void => {
    onChange((c) => {
      c.sprites = Object.fromEntries(
        source.filter((r) => r.expression.trim() !== "").map((r) => [r.expression.trim(), r.file]),
      );
      // 逐差分的取景覆盖：没选的那条就不写，落角色级的 framing 上。
      // 清空一条覆盖不该连带删掉别的差分，只把这一条从表里摘掉。
      const overrides = Object.fromEntries(
        source
          .filter((r) => r.expression.trim() !== "" && r.framing !== "")
          .map((r) => [r.expression.trim(), r.framing as SpriteFraming]),
      );
      if (Object.keys(overrides).length > 0) c.spriteFraming = overrides;
      else delete c.spriteFraming;
    });
  };

  const setFraming = (id: number, framing: SpriteFraming | ""): void => {
    const next = rows.map((r) => (r.id === id ? { ...r, framing } : r));
    setRows(next);
    commit(next);
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
    setRows((prev) => [...prev, { id: nextId.current++, expression: "", file: files[0] ?? "", framing: "" }]);
  };

  return (
    <div className="char-card">
      <div className="row">
        <input value={char.name} onChange={(e) => onChange((c) => (c.name = e.target.value))} />
      </div>
      {/* 导入入口紧跟名字：埋在立绘差分区下面的话，没人会往下翻 */}
      <div className="row small">
        <button
          className="ghost-btn"
          onClick={onBrowseLibrary}
          title={`从资源库导入一个角色的角色卡与立绘（按条目的 id 新建或覆盖同 id 的角色，不是填这张卡）`}
        >
          <span className="btn-icon">
            <Icon name="download" size={13} /> 从资源库导入
          </span>
        </button>
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
        <button className="ghost-btn voice-picker" onClick={onPickVoice}>
          音色：{voices.nameOf(char.voiceId)}
        </button>
        {char.voiceId && (
          <button className="ghost-btn" onClick={() => onChange((c) => (c.voiceId = undefined))}>
            清除
          </button>
        )}
        <button className="ghost-btn" disabled={!char.voiceId || previewing} onClick={previewVoice}>
          {previewing ? "合成中…" : "试听"}
        </button>
      </div>
      <p className="muted small">立绘差分映射（表情 → 立绘）</p>
      <div className="row small">
        <span className="muted small">取景</span>
        <select
          value={char.framing ?? ""}
          onChange={(e) =>
            onChange((c) => {
              const value = e.target.value as SpriteFraming | "";
              if (value) c.framing = value;
              else delete c.framing;
            })
          }
        >
          {/* 空项 = 不声明，舞台与出图都退回全身（存量角色卡就是这样，不要逼用户为老条目选一次） */}
          <option value="">未声明（全身）</option>
          {SPRITE_FRAMINGS.map((f) => (
            <option key={f} value={f}>
              {SPRITE_FRAMING_LABELS[f]}
            </option>
          ))}
        </select>
      </div>
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
          <select
            value={row.framing}
            onChange={(e) => setFraming(row.id, e.target.value as SpriteFraming | "")}
            title="这条差分的取景；留空跟随上面的角色取景"
          >
            <option value="">跟随角色</option>
            {SPRITE_FRAMINGS.map((f) => (
              <option key={f} value={f}>
                {SPRITE_FRAMING_LABELS[f]}
              </option>
            ))}
          </select>
          <button className="link-btn" onClick={() => dropRow(row.id)}>
            删
          </button>
        </div>
      ))}
      <div className="row small">
        <label className="btn-as-label small">
          上传立绘
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadSprite(file);
              e.target.value = "";
            }}
          />
        </label>
        <button className="ghost-btn" onClick={addRow}>
          <span className="btn-icon">
            <Icon name="plus" size={13} /> 添加映射
          </span>
        </button>
      </div>
    </div>
  );
}
