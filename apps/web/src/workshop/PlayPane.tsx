import { useCallback, useEffect, useState } from "react";
import type {
  CraftAssetSources,
  CraftAudioSource,
  CraftBackgroundSource,
  CraftBeatLength,
  CraftCgSource,
  CraftParams,
  CraftSpriteSource,
  CraftStopOptions,
  PlayConfig,
  PlayCover,
  PlayImageConfig,
} from "@stage-ai/core";
import { DEFAULT_CRAFT, languageLabel, LANGUAGE_LABELS } from "@stage-ai/core";
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
          <span>剧本语言（正文、旁白与选项用什么语言写）</span>
          <select
            value={draft.scriptLanguage ?? ""}
            onChange={(e) => patch((p) => (p.scriptLanguage = e.target.value || undefined))}
          >
            <option value="">跟随玩家输入</option>
            {Object.keys(LANGUAGE_LABELS)
              .sort()
              .map((code) => (
                <option key={code} value={code}>
                  {languageLabel(code)}（{code}）
                </option>
              ))}
          </select>
          <p className="muted small">不设 = 玩家用中文问就写中文；设死了则无论玩家说什么都用它写。</p>
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
        <label className="field">
          <span>生图模型（这本剧目专用的，留空跟服务端全局）</span>
          <input
            value={draft.image?.model ?? ""}
            placeholder="跟服务端全局"
            onChange={(e) => patch((p) => setImage(p, "model", e.target.value))}
          />
        </label>
        <label className="field">
          <span>生图档位（1K / 2K / 4K，openai 侧也可写字面尺寸）</span>
          <input
            value={draft.image?.size ?? ""}
            placeholder="跟服务端全局"
            onChange={(e) => patch((p) => setImage(p, "size", e.target.value))}
          />
        </label>
        <CoverPicker
          playId={playId}
          assets={assets}
          current={draft.cover}
          onPick={(cover) => patch((p) => (p.cover = cover))}
          onClear={() => patch((p) => delete p.cover)}
        />

      </section>

      <section className="panel">
        <h3>写作参数</h3>
        <p className="muted small">
          这部剧每轮怎么写。选「默认」= 这一项从 play.json 里消失、跟着引擎默认走；
          文风与禁忌那类只能拿话说的事在「记忆」页的 craft.md 里。
        </p>
        <CraftSelect
          label="每轮篇幅"
          value={draft.craft?.beatLength ?? ""}
          options={CRAFT_OPTIONS.beatLength}
          onChange={(v) => patch((p) => editCraft(p, "beatLength", v))}
        />
        <CraftSelect
          label="停止点选项"
          value={draft.craft?.stopOptions ?? ""}
          options={CRAFT_OPTIONS.stopOptions}
          onChange={(v) => patch((p) => editCraft(p, "stopOptions", v))}
        />
        <CraftSelect
          label="素材来源：背景"
          value={draft.craft?.assets?.background ?? ""}
          options={CRAFT_OPTIONS.background}
          onChange={(v) => patch((p) => editCraft(p, "background", v))}
        />
        <CraftSelect
          label="素材来源：插图（CG）"
          value={draft.craft?.assets?.cg ?? ""}
          options={CRAFT_OPTIONS.cg}
          onChange={(v) => patch((p) => editCraft(p, "cg", v))}
        />
        <CraftSelect
          label="素材来源：立绘"
          value={draft.craft?.assets?.sprite ?? ""}
          options={CRAFT_OPTIONS.sprite}
          onChange={(v) => patch((p) => editCraft(p, "sprite", v))}
        />
        <CraftSelect
          label="素材来源：音乐与音效"
          value={draft.craft?.assets?.audio ?? ""}
          options={CRAFT_OPTIONS.audio}
          onChange={(v) => patch((p) => editCraft(p, "audio", v))}
        />
      </section>

      <p className="row">
        <button className="primary" onClick={savePlay}>
          保存
        </button>
        {saved && <span className="muted small">已保存</span>}
      </p>

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

/**
 * 写作参数的六项下拉：第一项恒为「默认」，选中它 = 那一行从 play.json 里消失。
 *
 * **与默认值同义的那一项不列出来**：选了它 `editCraft` 照样会把字段删掉，于是下拉会立刻弹回
 * 「默认（…）」，看着像没选上。默认值只在第一项的括注里报一次。
 */
const CRAFT_OPTIONS: Record<CraftField, readonly (readonly [string, string])[]> = {
  beatLength: [
    ["", "默认（中等：8~15 句）"],
    ["short", "短：3~6 句，一个来回就收"],
    ["long", "长：20~30 句，能演完一整场戏"],
  ],
  stopOptions: [
    ["", "默认（每次 3 条）"],
    ["two", "每次 2 条"],
    ["four", "每次 4 条"],
    ["free", "固定停在自由输入框"],
  ],
  background: [
    ["", "默认（素材资源库里优先，没有再出图）"],
    ["library", "只用素材资源库里现成的"],
    ["generate", "直接出图，不去库里找"],
  ],
  cg: [
    ["", "默认（直接出图）"],
    ["library", "只用素材资源库里现成的"],
    ["off", "不用插图"],
  ],
  sprite: [
    ["", "默认（出图）"],
    ["off", "不出立绘"],
  ],
  audio: [
    ["", "默认（只用素材资源库里现成的）"],
    ["off", "不用音乐音效"],
  ],
};

/** 写作参数的一个下拉（六项共用一套壳）。 */
function CraftSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

type CraftField = "beatLength" | "stopOptions" | "background" | "cg" | "sprite" | "audio";

/**
 * 写作参数的就地修改：值与默认相同（或选了「默认」）就把那个字段删掉。
 *
 * play.json 里「没写」就是「走引擎默认」——写一个与默认相同的值，日后引擎默认改了它不跟着改；
 * 用户也就永远看不到「这项现在是默认的」。与 Agent 页的 `setOrClear` 同一条规矩。
 */
function editCraft(play: PlayConfig, field: CraftField, value: string): void {
  const craft: CraftParams = { ...(play.craft ?? {}) };
  const assets: CraftAssetSources = { ...(craft.assets ?? {}) };
  const blank = (fallback: string): boolean => value === "" || value === fallback;
  switch (field) {
    case "beatLength":
      if (blank(DEFAULT_CRAFT.beatLength)) delete craft.beatLength;
      else craft.beatLength = value as CraftBeatLength;
      break;
    case "stopOptions":
      if (blank(DEFAULT_CRAFT.stopOptions)) delete craft.stopOptions;
      else craft.stopOptions = value as CraftStopOptions;
      break;
    case "background":
      if (blank(DEFAULT_CRAFT.assets.background)) delete assets.background;
      else assets.background = value as CraftBackgroundSource;
      break;
    case "cg":
      if (blank(DEFAULT_CRAFT.assets.cg)) delete assets.cg;
      else assets.cg = value as CraftCgSource;
      break;
    case "sprite":
      if (blank(DEFAULT_CRAFT.assets.sprite)) delete assets.sprite;
      else assets.sprite = value as CraftSpriteSource;
      break;
    case "audio":
      if (blank(DEFAULT_CRAFT.assets.audio)) delete assets.audio;
      else assets.audio = value as CraftAudioSource;
      break;
  }
  if (Object.keys(assets).length > 0) craft.assets = assets;
  else delete craft.assets;
  if (Object.keys(craft).length > 0) play.craft = craft;
  else delete play.craft;
}

/** 逐剧目的生图模型 / 档位：两个字段都留空就把整个 `image` 段删掉。 */
function setImage(play: PlayConfig, key: "model" | "size", value: string): void {
  const image: PlayImageConfig = { ...(play.image ?? {}) };
  const text = value.trim();
  if (text === "") delete image[key];
  else image[key] = text;
  if (Object.keys(image).length > 0) play.image = image;
  else delete play.image;
}
