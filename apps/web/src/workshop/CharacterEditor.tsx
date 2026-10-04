import { useEffect, useState } from "react";
import type { CharacterDocument } from "@aivn/core";
import { characterCardPath } from "@aivn/core";
import { api } from "../api.js";
import { Icon } from "../ui/Icon.js";
import type { VoiceCatalogState } from "../voice/useVoiceCatalog.js";

/**
 * 角色卡编辑器：名字 / persona / 音色，全部写角色卡（`characters/<id>.md`）。
 * play.json 的 `characters` 是纯元数据，不经这里。
 *
 * 立绘不在这里：它是与角色卡同名的**可选**素材（`assets/sprites/<id>/`），
 * 机甲、道具那类没有卡的主体照样有立绘——所以立绘的上传、声明与生图都在素材页。
 *
 * 主角与普通角色共用它——两者是同一种东西。主角不高亮某个字段、也不锁某个字段，
 * 唯一的不同是宿主不给 `onRemove`（主角卡是剧目的一部分，删了就没人可演）。
 */
export function CharacterEditor({
  playId,
  charId,
  doc,
  voices,
  onPickVoice,
  onBrowseLibrary,
  onDocChange,
  onRemove,
}: {
  playId: string;
  charId: string;
  /** 角色卡 markdown 的解析结果。编辑进这里，保存时才落盘。 */
  doc: CharacterDocument;
  voices: VoiceCatalogState;
  onPickVoice: () => void;
  onBrowseLibrary: () => void;
  onDocChange: (fn: (doc: CharacterDocument) => void) => void;
  /** 不给就没有「移除角色」这一项（主角卡不给）。 */
  onRemove?: () => void;
}) {
  const [previewing, setPreviewing] = useState(false);

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

  return (
    <div className="char-card">
      <div className="row">
        <input value={doc.name ?? ""} onChange={(e) => onDocChange((d) => (d.name = e.target.value))} />
      </div>
      <div className="row small">
        <button
          className="ghost-btn"
          onClick={onBrowseLibrary}
          title="从资源库导入一个角色的角色卡与立绘（落在条目对应的角色卡上，不是填这一张）"
        >
          <span className="btn-icon">
            <Icon name="download" size={13} /> 从资源库导入
          </span>
        </button>
        {onRemove && (
          <button className="link-btn" onClick={onRemove}>
            移除角色
          </button>
        )}
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
      <p className="muted small">
        角色卡：<code>{characterCardPath(charId)}</code>
        ；（可选）同名立绘在素材页「立绘」里
      </p>
    </div>
  );
}
