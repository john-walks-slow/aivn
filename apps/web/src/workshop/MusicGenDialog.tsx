import { useState, useEffect, useRef } from "react";
import type { GeneratedAsset } from "@aivn/core";
import { Icon, Modal } from "@aivn/stage";
import { api } from "../api.js";

interface MusicTemplate {
  label: string;
  defaultName: string;
  defaultTitle: string;
  prompt: string;
  mood: string[];
  scene: string[];
  tags: string[];
  loop: boolean;
  volume: number;
  description: string;
}

const TEMPLATES: MusicTemplate[] = [
  {
    label: "校园日常 / 轻松闲聊",
    defaultName: "bgm_daily_peace",
    defaultTitle: "午后微光",
    prompt:
      "solo upright piano, gentle and warm Japanese visual novel daily background music, key of C major, royal road progression, delicate touch, sparse arrangement, steady tempo 84 bpm, seamless loop, flat dynamics, pure acoustic instrumental only, no drums, no vocals",
    mood: ["温暖", "日常", "轻松"],
    scene: ["教室", "日常", "闲聊"],
    tags: ["日系", "钢琴", "日常", "循环"],
    loop: true,
    volume: 0.38,
    description: "午后放学后的日常对话垫底，触键轻柔不盖台词；无前后奏，平坦动态可无限循环。",
  },
  {
    label: "心动告白 / 两人独处",
    defaultName: "bgm_romance_whisper",
    defaultTitle: "靠近的心意",
    prompt:
      "fingerpicked nylon acoustic guitar with warm soft strings pad, intimate romantic Japanese visual novel dialogue background music, tender and hesitant, warm major seventh chords, slow tempo 72 bpm, flat dynamics, seamless loop, pure acoustic instrumental only, no drums, no percussion, no vocals",
    mood: ["温柔", "心动", "微妙"],
    scene: ["告白", "独白", "内心戏"],
    tags: ["日系", "弦乐", "轻音乐", "温柔", "循环"],
    loop: true,
    volume: 0.36,
    description: "两人近距离独处的微妙氛围。尼龙吉他与暖色弦乐垫底，留出人声频段。",
  },
  {
    label: "黄昏放学 / 怀旧物哀",
    defaultName: "bgm_sunset_nostalgia",
    defaultTitle: "夕阳下的归途",
    prompt:
      "antique music box and sparse solo upright piano, nostalgic bittersweet Japanese visual novel memory theme, reflective and wistful, minor key with major seventh resolution, slow waltz tempo, steady gentle rhythm, seamless loop, pure instrumental only, no drums, no beat, no vocals",
    mood: ["怀念", "怀旧", "惆怅"],
    scene: ["回忆", "黄昏", "街道"],
    tags: ["日系", "八音盒", "钢琴", "怀旧", "循环"],
    loop: true,
    volume: 0.38,
    description: "放学归途夕阳与回忆的物哀八音盒旋律。三拍子缓慢流淌，音色复古柔和。",
  },
  {
    label: "泪点别离 / 雨中哀伤",
    defaultName: "bgm_rain_melancholy",
    defaultTitle: "未传达的话语",
    prompt:
      "sparse solo upright piano, melancholic and deeply emotional Japanese visual novel sad background music, bittersweet wistful, delicate touch, high register focus, spacious pauses between notes, slow tempo 66 bpm, seamless loop, pure acoustic instrumental only, no drums, no bass, no vocals",
    mood: ["忧伤", "孤独", "寂寥"],
    scene: ["独白", "回忆", "告别"],
    tags: ["日系", "钢琴", "轻音乐", "伤感", "循环"],
    loop: true,
    volume: 0.35,
    description: "深层感伤独白。高音区单音留白，中频人声频段完全避让，无前后奏。",
  },
  {
    label: "悬疑暗流 / 调查推理",
    defaultName: "bgm_suspense_shadow",
    defaultTitle: "走廊的阴翳",
    prompt:
      "dark ambient piano with low sustained strings, tense and restrained Japanese visual novel mystery background music, minor key, steady rhythm, seamless loop, flat dynamics throughout, instrumental only, no drums, no vocals",
    mood: ["紧张", "压抑", "悬疑"],
    scene: ["悬疑", "危机", "推理"],
    tags: ["轻音乐", "环境音", "日系", "循环"],
    loop: true,
    volume: 0.40,
    description: "探查调查段落垫底。低沉暗涌弦乐，持续平坦动态，不抢戏不高潮。",
  },
  {
    label: "终章救赎 / 真爱誓言",
    defaultName: "bgm_climax_resolve",
    defaultTitle: "繁星的指引",
    prompt:
      "uplifting solo upright piano with subtle chamber cello, hopeful and touching Japanese visual novel climax background music, Canon chord progression with warm emotional resolution, steady moderate tempo 80 bpm, seamless loop, pure acoustic instrumental only, no drums, no brass, no vocals",
    mood: ["温暖", "释然", "决意"],
    scene: ["高潮", "结局", "和解"],
    tags: ["日系", "钢琴", "概念原声", "治愈", "循环"],
    loop: true,
    volume: 0.40,
    description: "结局心意明朗时的救赎高潮。卡农暖色进行，平稳无过载，可循环播放。",
  },
];

const DEFAULT_TPL: MusicTemplate = TEMPLATES[0]!;

export function MusicGenDialog({
  playId,
  initialName = "",
  initialPrompt = "",
  subscribeAssetReady,
  onClose,
  onDone,
}: {
  playId: string;
  initialName?: string;
  initialPrompt?: string;
  subscribeAssetReady?: (handler: (asset: GeneratedAsset) => void) => () => void;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [name, setName] = useState(initialName || DEFAULT_TPL.defaultName);
  const [title, setTitle] = useState(DEFAULT_TPL.defaultTitle);
  const [prompt, setPrompt] = useState(initialPrompt || DEFAULT_TPL.prompt);
  const [description, setDescription] = useState(DEFAULT_TPL.description);
  const [moodText, setMoodText] = useState(DEFAULT_TPL.mood.join(", "));
  const [sceneText, setSceneText] = useState(DEFAULT_TPL.scene.join(", "));
  const [tagsText, setTagsText] = useState(DEFAULT_TPL.tags.join(", "));
  const [loop, setLoop] = useState(DEFAULT_TPL.loop);
  const [volume, setVolume] = useState(DEFAULT_TPL.volume);
  const [overwrite, setOverwrite] = useState(true);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [completedUrl, setCompletedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const waitingIdRef = useRef<string | null>(null);

  const applyTemplate = (tpl: MusicTemplate) => {
    setName(tpl.defaultName);
    setTitle(tpl.defaultTitle);
    setPrompt(tpl.prompt);
    setDescription(tpl.description);
    setMoodText(tpl.mood.join(", "));
    setSceneText(tpl.scene.join(", "));
    setTagsText(tpl.tags.join(", "));
    setLoop(tpl.loop);
    setVolume(tpl.volume);
  };

  useEffect(() => {
    if (!subscribeAssetReady) return;
    const unsub = subscribeAssetReady((asset: GeneratedAsset) => {
      if (asset.type === "bgm" && asset.id === waitingIdRef.current) {
        setQueued(false);
        setCompletedUrl(asset.url ?? null);
        onDone?.();
      }
    });
    return unsub;
  }, [subscribeAssetReady, onDone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanPrompt = prompt.trim();
    if (!cleanName || !cleanPrompt) {
      setError("素材标识和提示词不能为空");
      return;
    }
    setError(null);
    setSubmitting(true);
    waitingIdRef.current = cleanName;

    try {
      const mood = moodText.split(/[,，\s]+/).filter(Boolean);
      const scene = sceneText.split(/[,，\s]+/).filter(Boolean);
      const tags = tagsText.split(/[,，\s]+/).filter(Boolean);

      await api.generateMusic(playId, {
        name: cleanName,
        prompt: cleanPrompt,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        mood: mood.length > 0 ? mood : undefined,
        scene: scene.length > 0 ? scene : undefined,
        tags: tags.length > 0 ? tags : undefined,
        loop,
        volume,
        overwrite,
      });

      setSubmitting(false);
      setQueued(true);
      onDone?.();
    } catch (err) {
      setSubmitting(false);
      waitingIdRef.current = null;
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal onClose={onClose} title="✨ 手动生成背景音乐 (BGM)" width={540}>
      <div style={{ maxWidth: 540 }}>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

        {completedUrl ? (
          <div style={{ padding: "16px 0", textAlign: "center" }}>
            <div style={{ color: "var(--success-ink, #10b981)", marginBottom: 12, fontWeight: "bold" }}>
              ✓ 音乐生成完成并已入库！
            </div>
            <audio controls src={completedUrl} style={{ width: "100%", marginBottom: 16 }} autoPlay />
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={onClose}>
                完成
              </button>
            </div>
          </div>
        ) : queued ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
              <Icon name="volume" size={20} />
              <strong>正在后台排产生成中...</strong>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              生成一首完整的日系配乐通常需要 40 ~ 80 秒。<br />
              任务已在底栏排队面板中运行，您可以关闭对话框继续进行其他操作，到货后素材列表将自动刷新。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn btn-secondary" onClick={onClose}>
                在后台生成（关闭弹窗）
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                快速风格模板（点击一键填入经声学验证的 Prompt）
              </label>
              <select
                className="input"
                style={{ width: "100%" }}
                onChange={(e) => {
                  const idx = parseInt(e.target.value, 10);
                  const chosen = TEMPLATES[idx];
                  if (chosen) applyTemplate(chosen);
                }}
              >
                {TEMPLATES.map((tpl, i) => (
                  <option key={tpl.defaultName} value={i}>
                    {tpl.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="music-form-grid">
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  素材标识 (ID)
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如 bgm_daily_peace"
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  曲目名 (Title)
                </label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%" }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="如 午后微光"
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                生成提示词 (Prompt · 英文)
              </label>
              <textarea
                className="input"
                style={{ width: "100%", height: 96, resize: "vertical", fontSize: 13, lineHeight: 1.4 }}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="按六段式书写，首尾需包含纯器乐与对白垫底锚定..."
                required
              />
            </div>

            <div>
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12 }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? "收起高级选曲设置 ▲" : "展开高级选曲设置 (Mood/Scene/Volume) ▼"}
              </button>
            </div>

            {showAdvanced && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-subtle, rgba(0,0,0,0.03))", padding: 10, borderRadius: 6 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>
                    描述说明 (Description)
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", fontSize: 12 }}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="music-form-grid">
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>
                      情绪 (Mood 逗号分隔)
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: "100%", fontSize: 12 }}
                      value={moodText}
                      onChange={(e) => setMoodText(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>
                      场景 (Scene 逗号分隔)
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: "100%", fontSize: 12 }}
                      value={sceneText}
                      onChange={(e) => setSceneText(e.target.value)}
                    />
                  </div>
                </div>
                <div className="music-form-grid">
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>
                      标签 (Tags)
                    </label>
                    <input
                      type="text"
                      className="input"
                      style={{ width: "100%", fontSize: 12 }}
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 2 }}>
                      默认音量 ({Math.round(volume * 100)}%)
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.01"
                      value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={(e) => setLoop(e.target.checked)}
                    />
                    循环播放 (loop: true)
                  </label>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    允许覆盖同名文件
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                取消
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "正在发起..." : "开始生成 (约 40-80s)"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
