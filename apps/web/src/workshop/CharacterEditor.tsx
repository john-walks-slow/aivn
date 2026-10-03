import { useEffect, useRef, useState } from "react";
import type { CharacterDocument, SpriteFraming } from "@aivn/core";
import { SPRITE_FRAMINGS, SPRITE_FRAMING_LABELS } from "@aivn/core";
import { api } from "../api.js";
import { Icon } from "../ui/Icon.js";
import type { VoiceCatalogState } from "../voice/useVoiceCatalog.js";

interface SpriteRow {
  id: number;
  expression: string;
  file: string;
  framing: SpriteFraming | "";
}

/**
 * 角色卡编辑器：名字 / persona / 音色 / 立绘差分映射，全部写角色卡
 * （`memory/always/characters/<id>.md`）。play.json 的 `characters` 是纯元数据，不经这里。
 */
export function CharacterEditor({
  playId,
  charId,
  doc,
  files,
  voices,
  onPickVoice,
  onBrowseLibrary,
  onUploadSprite,
  onGenerateSprite,
  onDocChange,
  onRemove,
}: {
  playId: string;
  charId: string;
  /** 角色卡 markdown 的解析结果。编辑进这里，保存时才落盘。 */
  doc: CharacterDocument;
  files: string[];
  voices: VoiceCatalogState;
  onPickVoice: () => void;
  onBrowseLibrary: () => void;
  onUploadSprite: (file: File) => void;
  /** 点击「生成立绘」或行内「重生成」时唤起手动生图对话框 */
  onGenerateSprite?: (target: { expression?: string; framing?: SpriteFraming; fixed?: boolean }) => void;
  onDocChange: (fn: (doc: CharacterDocument) => void) => void;
  onRemove: () => void;
}) {
  const nextId = useRef(0);
  const [previewing, setPreviewing] = useState(false);
  // 行状态挂载时从角色卡初始化；编辑期以本地行为准，blur/离散操作时提交回角色卡
  const [rows, setRows] = useState<SpriteRow[]>(() =>
    Object.entries(doc.sprites ?? {}).map(([expression, file]) => ({
      id: nextId.current++,
      expression,
      file,
      framing: doc.spriteFraming?.[expression] ?? "",
    })),
  );

  /** 音色试听：服务端合成固定样本 → 播放（Fish 公共库音色，目录内目录外都能试）。 */
  const previewVoice = (): void => {
    if (!doc.voiceId || previewing) return;
    setPreviewing(true);
    api
      .ttsPreview(playId, doc.voiceId)
      .then(({ url }) => {
        void new Audio(url).play().catch(() => {});
      })
      .catch((e: Error) => window.alert(`试听失败：${e.message}`))
      .finally(() => setPreviewing(false));
  };

  // 目录外的 voiceId（demo 剧目的萝莉萌妹等）按 id 单条解析出名字，不装作"未设置"
  const { resolve: resolveVoice } = voices;
  useEffect(() => {
    resolveVoice(doc.voiceId);
  }, [resolveVoice, doc.voiceId]);

  const commit = (source: SpriteRow[]): void => {
    onDocChange((d) => {
      d.sprites = Object.fromEntries(
        source.filter((r) => r.expression.trim() !== "").map((r) => [r.expression.trim(), r.file]),
      );
      // 逐差分的取景覆盖：没选的那条就不写，落角色级的 framing 上。
      // 清空一条覆盖不该连带删掉别的差分，只把这一条从表里摘掉。
      const overrides = Object.fromEntries(
        source
          .filter((r) => r.expression.trim() !== "" && r.framing !== "")
          .map((r) => [r.expression.trim(), r.framing as SpriteFraming]),
      );
      if (Object.keys(overrides).length > 0) d.spriteFraming = overrides;
      else delete d.spriteFraming;
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
        <input value={doc.name ?? ""} onChange={(e) => onDocChange((d) => (d.name = e.target.value))} />
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
        value={doc.body}
        onChange={(e) => onDocChange((d) => (d.body = e.target.value))}
      />
      <div className="voice-row">
        <button className="ghost-btn voice-picker" onClick={onPickVoice}>
          {/* 卡里的 voice 是人话描述；没写就退回按 voiceId 现查目录 */}
          音色：{doc.voice ?? voices.nameOf(doc.voiceId)}
        </button>
        {doc.voiceId && (
          <button
            className="ghost-btn"
            onClick={() =>
              onDocChange((d) => {
                d.voiceId = undefined;
                d.voice = undefined;
              })
            }
          >
            清除
          </button>
        )}
        <button className="ghost-btn" disabled={!doc.voiceId || previewing} onClick={previewVoice}>
          {previewing ? "合成中…" : "试听"}
        </button>
      </div>
      <p className="muted small">立绘差分映射（表情 → 立绘）</p>
      <div className="row small">
        <span className="muted small">取景</span>
        <select
          value={doc.framing ?? ""}
          onChange={(e) =>
            onDocChange((d) => {
              const value = e.target.value as SpriteFraming | "";
              if (value) d.framing = value;
              else delete d.framing;
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
          {onGenerateSprite && row.expression.trim() && (
            <button
              type="button"
              className="ghost-btn icon-only small"
              title={`重新生成「${row.expression}」差分`}
              onClick={() =>
                onGenerateSprite({
                  expression: row.expression.trim(),
                  framing: (row.framing as SpriteFraming) || doc.framing,
                  fixed: true,
                })
              }
            >
              <Icon name="sparkles" size={13} />
            </button>
          )}
          <button className="link-btn" onClick={() => dropRow(row.id)}>
            删
          </button>
        </div>
      ))}
      <div className="row small">
        {onGenerateSprite && (
          <button
            type="button"
            className="ghost-btn"
            onClick={() =>
              onGenerateSprite({
                expression: rows.length === 0 ? "neutral" : "",
                framing: doc.framing,
                fixed: false,
              })
            }
          >
            <span className="btn-icon">
              <Icon name="sparkles" size={13} /> 生成立绘
            </span>
          </button>
        )}
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
      <p className="muted small">
        角色卡：<code>memory/always/characters/{charId}.md</code>
      </p>
    </div>
  );
}