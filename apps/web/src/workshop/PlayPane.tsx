import { useCallback, useEffect, useState } from "react";
import type { PlayConfig, PlayCover } from "@stage-ai/core";
import { languageLabel, LANGUAGE_LABELS } from "@stage-ai/core";
import { api, assetUrl } from "../api.js";
import { Icon } from "../ui/Icon.js";
import { VoiceLibrary } from "../voice/VoiceLibrary.js";
import { useVoiceCatalog } from "../voice/useVoiceCatalog.js";

/**
 * 剧目：这部剧作为一个整体是什么——标题、开局指令、语音语言、无名角色音色、封面。
 *
 * 与「角色」「记忆」分开：它们改的是剧目里的成员与内容，这里改的是剧目本身，
 * 而且只写 play.json 一份。挤在一页里，用户得先分清「这条改动落在哪个文件上」。
 */
export function PlayPane({ playId, revision }: { playId: string; revision: number }) {
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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

  if (!draft) return <div className="workshop-tab-pane">读取中…</div>;

  return (
    <div className="workshop-tab-pane">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="panel">
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

        <p className="row">
          <button className="primary" onClick={savePlay}>
            保存
          </button>
          {saved && <span className="muted small">已保存</span>}
        </p>
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
