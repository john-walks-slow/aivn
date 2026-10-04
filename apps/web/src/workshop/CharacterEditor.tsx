import { useEffect, useState } from "react";
import type { CharacterDocument } from "@aivn/core";
import { characterCardPath } from "@aivn/core";
import { api } from "../api.js";
import type { VoiceCatalogState } from "../voice/useVoiceCatalog.js";

/**
 * 角色卡编辑器：名字 / 人设 / 音色三格，全部写角色卡（`characters/<id>.md`）。
 * play.json 的 `characters` 是纯元数据，不经这里。
 *
 * 三格按「先给谁看、再是什么样的人、最后什么声音」排；卡级动作（从资源库导入、移除角色）
 * 不在这里——那些动的是整张卡、不是卡里的一格，归宿主的面板标题行。
 *
 * 主角与普通角色共用它——两者是同一种东西。主角不高亮某个字段、也不锁某个字段。
 */
export function CharacterEditor({
  playId,
  charId,
  doc,
  voices,
  onPickVoice,
  onDocChange,
}: {
  playId: string;
  charId: string;
  /** 角色卡 markdown 的解析结果。编辑进这里，保存时才落盘。 */
  doc: CharacterDocument;
  voices: VoiceCatalogState;
  onPickVoice: () => void;
  onDocChange: (fn: (doc: CharacterDocument) => void) => void;
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
      <label className="field">
        <span>名字</span>
        <input
          value={doc.name ?? ""}
          placeholder="上台时显示的名字"
          onChange={(e) => onDocChange((d) => (d.name = e.target.value))}
        />
      </label>

      <label className="field">
        <span>人设</span>
        <textarea
          rows={4}
          placeholder="性格与背景（剧作家每轮都会读到）"
          value={doc.body}
          onChange={(e) => onDocChange((d) => (d.body = e.target.value))}
        />
      </label>

      <div className="field">
        <span>音色</span>
        <div className="voice-row">
          <button className="ghost-btn voice-picker" onClick={onPickVoice}>
            {doc.voiceId ? (doc.voice ?? voices.nameOf(doc.voiceId)) : "用剧目默认（点这里挑一个）"}
          </button>
          <button
            className="ghost-btn"
            disabled={!doc.voiceId || previewing}
            onClick={previewVoice}
            title="合成一句样本听听"
          >
            {previewing ? "合成中…" : "试听"}
          </button>
          {doc.voiceId && (
            <button
              className="link-btn"
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
        </div>
      </div>

      <p className="muted small">
        角色卡：<code>{characterCardPath(charId)}</code>
      </p>
    </div>
  );
}
