import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { api, type GatewayModel, type Settings } from "../api.js";
import { navigate } from "../router.jsx";
import { ModelSelect, modelSourceHint } from "../ui/ModelSelect.js";
import {
  ACCENT_CHANGED,
  ACCENT_PRESETS,
  DEFAULT_ACCENT_CUSTOM,
  DEFAULT_STAGE_MODE,
  DEFAULT_UI_MODE,
  THEME_MODE_CHANGED,
  readAccent,
  setAccent,
  setThemeMode,
  type AccentId,
  type ThemeMode,
} from "../hooks/useTheme.js";

const UI_MODE_KEY = "stage-ai:ui-theme-mode";
const STAGE_MODE_KEY = "stage-ai:stage-theme-mode";

function storedMode(key: string, fallback: ThemeMode): ThemeMode {
  const val = localStorage.getItem(key);
  return val === "system" || val === "light" || val === "dark" ? val : fallback;
}

type Draft = {
  password: string;
  model: Settings["model"];
  workshopContext: Settings["workshopContext"];
  beatTimeoutMs: number;
  image: Settings["image"];
  tts: Omit<Settings["tts"], "keys"> & { keys: string };
  exa: Omit<Settings["exa"], "keys"> & { keys: string };
};

/** 读视图 → 可编辑草稿（凭据输入框一律留空：留空 = 不改）。 */
function draftOf(next: Settings): Draft {
  return {
    password: "",
    model: { ...next.model, apiKey: "" },
    workshopContext: { ...next.workshopContext },
    beatTimeoutMs: next.beatTimeoutMs,
    image: { ...next.image, apiKey: "" },
    tts: { ...next.tts, keys: "" },
    exa: { ...next.exa, keys: "" },
  };
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [models, setModels] = useState<GatewayModel[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  // 主题模式状态（分别保存 UI 和 舞台）
  const [uiMode, setUiMode] = useState<ThemeMode>(() => storedMode(UI_MODE_KEY, DEFAULT_UI_MODE));
  const [stageMode, setStageMode] = useState<ThemeMode>(() =>
    storedMode(STAGE_MODE_KEY, DEFAULT_STAGE_MODE),
  );
  const [accent, setAccentState] = useState<{ id: AccentId; custom: string }>(() => readAccent());

  const loadModels = useCallback((refresh = false): void => {
    api
      .agentModels(refresh)
      .then((r) => {
        setModels(r.models);
        setModelError(null);
      })
      .catch((err: unknown) => setModelError(err instanceof Error ? err.message : String(err)));
  }, []);

  const load = useCallback(() => {
    api
      .settings()
      .then((next) => {
        setSettings(next);
        setDraft(draftOf(next));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    loadModels();
  }, [loadModels]);

  useEffect(load, [load]);

  // 监听存储变化，以便其他标签页的改动能同步 UI
  useEffect(() => {
    const handleStorage = (e: Event): void => {
      const key = (e as StorageEvent).key;
      if (key === UI_MODE_KEY) setUiMode(storedMode(UI_MODE_KEY, DEFAULT_UI_MODE));
      if (key === STAGE_MODE_KEY) setStageMode(storedMode(STAGE_MODE_KEY, DEFAULT_STAGE_MODE));
      if (key === ACCENT_CHANGED) setAccentState(readAccent());
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_MODE_CHANGED, handleStorage);
    window.addEventListener(ACCENT_CHANGED, handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_MODE_CHANGED, handleStorage);
      window.removeEventListener(ACCENT_CHANGED, handleStorage);
    };
  }, []);

  const save = async (): Promise<void> => {
    if (!draft) return;
    try {
      const { changed, settings: fresh } = await api.saveSettings(draft);
      setSaved(changed);
      setError(null);
      // 服务端已经就地生效，回传的读视图直接当新基准（凭据掩码也跟着更新）
      setSettings(fresh);
      setDraft(draftOf(fresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate("/")}>
          <span className="btn-icon">
            <Icon name="back" /> 剧目库
          </span>
        </button>
        <h2>设置</h2>
        <span className="muted">保存后立即生效（正在演的剧目会在本轮结束时换用新设置）</span>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="warn-banner" role="status" onClick={() => setSaved(null)}>
          已立即生效 {saved.length} 项：{saved.join("、")}
        </div>
      )}
      {!draft || !settings ? (
        <div className="overlay">读取设置…</div>
      ) : (
        <div className="settings-body">
          <Group title="模型网关">
            <Field label="模型 ID" hint={modelSourceHint(models ?? [], settings.model.models)}>
              <ModelSelect
                value={draft.model.modelId}
                models={models}
                error={modelError}
                onChange={(id) => setDraft({ ...draft, model: { ...draft.model, modelId: id } })}
                onRetry={() => loadModels(true)}
              />
            </Field>
            <Field label="限制级（NSFW）专用模型" hint="当剧作家调用 enter_nsfw 时切换至此模型。留空跟随主模型。">
              <ModelSelect
                value={draft.model.nsfwModelId ?? ""}
                models={models}
                error={modelError}
                emptyLabel={`跟随主模型（${draft.model.modelId}）`}
                onChange={(id) => setDraft({ ...draft, model: { ...draft.model, nsfwModelId: id } })}
                onRetry={() => loadModels(true)}
              />
            </Field>
            <Field label="支持的模型">
              <input
                value={draft.model.models}
                onChange={(e) => setDraft({ ...draft, model: { ...draft.model, models: e.target.value } })}
              />
            </Field>
            <Field label="元数据基座">
              <input
                value={draft.model.modelBase}
                onChange={(e) => setDraft({ ...draft, model: { ...draft.model, modelBase: e.target.value } })}
              />
            </Field>
            <Field label="网关地址">
              <input
                value={draft.model.baseUrl}
                onChange={(e) => setDraft({ ...draft, model: { ...draft.model, baseUrl: e.target.value } })}
              />
            </Field>
            <Field
              label="API Key"
              hint={
                settings.model.apiKeySet
                  ? "留空或保持掩码即不改；输入新值即替换"
                  : "尚未配置——不填则播放会 401"
              }
            >
              <input
                type="password"
                placeholder={settings.model.apiKey || "未配置"}
                onChange={(e) => setDraft({ ...draft, model: { ...draft.model, apiKey: e.target.value } })}
              />
            </Field>
            <div className="settings-grid">
              <NumField
                label="输出上限"
                hint="超过网关限制会返回 400，内容为空"
                value={draft.model.maxTokens}
                onChange={(v) => setDraft({ ...draft, model: { ...draft.model, maxTokens: v } })}
              />
              <NumField
                label="上下文窗口"
                value={draft.model.contextWindow}
                onChange={(v) => setDraft({ ...draft, model: { ...draft.model, contextWindow: v } })}
              />
              <NumField
                label="压缩阈值"
                hint="占窗口比例 0–1"
                step={0.05}
                value={draft.model.compactRatio}
                onChange={(v) => setDraft({ ...draft, model: { ...draft.model, compactRatio: v } })}
              />
              <NumField
                label="保留上下文"
                hint="必须小于压缩阈值"
                value={draft.model.keepRecentTokens}
                onChange={(v) => setDraft({ ...draft, model: { ...draft.model, keepRecentTokens: v } })}
              />
              <NumField
                label="单轮超时 ms"
                hint="一轮多久没写完就当失败"
                step={1000}
                value={draft.beatTimeoutMs}
                onChange={(v) => setDraft({ ...draft, beatTimeoutMs: v })}
              />
            </div>
          </Group>

          <Group title="工坊线程">
            <p className="settings-hint">
              工坊可以和剧作家用不同的模型，压缩阈值因此另有一套；缺省与上面一致。
            </p>
            <div className="settings-grid">
              <NumField
                label="工坊上下文窗口"
                value={draft.workshopContext.contextWindow}
                onChange={(v) =>
                  setDraft({ ...draft, workshopContext: { ...draft.workshopContext, contextWindow: v } })
                }
              />
              <NumField
                label="工坊压缩阈值"
                hint="占窗口比例 0–1"
                step={0.05}
                value={draft.workshopContext.compactRatio}
                onChange={(v) =>
                  setDraft({ ...draft, workshopContext: { ...draft.workshopContext, compactRatio: v } })
                }
              />
              <NumField
                label="工坊保留上下文"
                hint="必须小于压缩阈值"
                value={draft.workshopContext.keepRecentTokens}
                onChange={(v) =>
                  setDraft({ ...draft, workshopContext: { ...draft.workshopContext, keepRecentTokens: v } })
                }
              />
            </div>
          </Group>

          <Group title="出图">
            <Field label="启用生图">
              <input
                type="checkbox"
                checked={draft.image.enabled}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, enabled: e.target.checked } })}
              />
            </Field>
            <Field label="接口格式" hint="gemini 支持垫图，openai 不支持">
              <select
                value={draft.image.format}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    image: { ...draft.image, format: e.target.value as Settings["image"]["format"] },
                  })
                }
              >
                <option value="gemini">gemini</option>
                <option value="openai">openai</option>
              </select>
            </Field>
            <Field
              label="生图 Key"
              hint={
                settings.image.apiKeySet
                  ? "留空或保持掩码即不改；输入新值即替换"
                  : "尚未配置——出图会被网关拒"
              }
            >
              <input
                type="password"
                placeholder={settings.image.apiKey || "未配置"}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, apiKey: e.target.value } })}
              />
            </Field>
            <Field label="生图地址" hint="服务根地址，不要带 /v1 或 /v1beta">
              <input
                value={draft.image.baseUrl}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, baseUrl: e.target.value } })}
              />
            </Field>
            <Field label="出图模型" hint="flow2api 需把画幅档位写进别名，否则画幅被忽略">
              <input
                value={draft.image.model}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, model: e.target.value } })}
              />
            </Field>
            <div className="settings-grid">
              <Field label="出图档位" hint="1K / 2K / 4K 或字面尺寸（如 1536x1024）">
                <input
                  value={draft.image.size}
                  onChange={(e) => setDraft({ ...draft, image: { ...draft.image, size: e.target.value } })}
                />
              </Field>
              <NumField
                label="出图并发"
                value={draft.image.concurrency}
                onChange={(v) => setDraft({ ...draft, image: { ...draft.image, concurrency: v } })}
              />
              <NumField
                label="出图超时 ms"
                value={draft.image.timeoutMs}
                onChange={(v) => setDraft({ ...draft, image: { ...draft.image, timeoutMs: v } })}
              />
            </div>
          </Group>

          <Group title="语音">
            <Field label="启用语音" hint="关掉只影响合成，文字照常">
              <input
                type="checkbox"
                checked={draft.tts.enabled}
                onChange={(e) => setDraft({ ...draft, tts: { ...draft.tts, enabled: e.target.checked } })}
              />
            </Field>
            <Field label="服务地址" hint="fish-audio 兼容端点">
              <input
                value={draft.tts.baseUrl}
                onChange={(e) => setDraft({ ...draft, tts: { ...draft.tts, baseUrl: e.target.value } })}
              />
            </Field>
            <Field label="代理" hint="如 http://127.0.0.1:7890">
              <input
                value={draft.tts.proxy}
                onChange={(e) => setDraft({ ...draft, tts: { ...draft.tts, proxy: e.target.value } })}
              />
            </Field>
            <NumField
              label="语音并发"
              value={draft.tts.concurrency}
              onChange={(v) => setDraft({ ...draft, tts: { ...draft.tts, concurrency: v } })}
            />
            <KeyField
              label="语音密钥"
              hint="多把 key 轮询；已存 {count} 把（留空=保持不变，填入=整组替换）"
              value={draft.tts.keys}
              masked={settings.tts.masked}
              onChange={(keys) => setDraft({ ...draft, tts: { ...draft.tts, keys } })}
            />
          </Group>

          <Group title="联网检索（Exa）">
            <Field label="启用检索" hint="关掉后工坊只剩离线工具">
              <input
                type="checkbox"
                checked={draft.exa.enabled}
                onChange={(e) => setDraft({ ...draft, exa: { ...draft.exa, enabled: e.target.checked } })}
              />
            </Field>
            <Field label="服务地址" hint="exa 兼容端点">
              <input
                value={draft.exa.baseUrl}
                onChange={(e) => setDraft({ ...draft, exa: { ...draft.exa, baseUrl: e.target.value } })}
              />
            </Field>
            <Field label="代理" hint="如 http://127.0.0.1:7890">
              <input
                value={draft.exa.proxy}
                onChange={(e) => setDraft({ ...draft, exa: { ...draft.exa, proxy: e.target.value } })}
              />
            </Field>
            <NumField
              label="检索超时 ms"
              value={draft.exa.timeoutMs}
              onChange={(v) => setDraft({ ...draft, exa: { ...draft.exa, timeoutMs: v } })}
            />
            <KeyField
              label="检索密钥"
              hint="多把 key 轮询；已存 {count} 把（留空=保持不变，填入=整组替换）"
              value={draft.exa.keys}
              masked={settings.exa.masked}
              onChange={(keys) => setDraft({ ...draft, exa: { ...draft.exa, keys } })}
            />
          </Group>

          <Group title="访问与启动">
            <Field
              label="访问密码"
              hint={
                settings.passwordSet
                  ? "已开启（HTTP Basic）——留空即不改；清空并保存 = 关闭设防"
                  : "当前没有设防。挂到公网前务必设一个（局域网自用可以不设）"
              }
            >
              <input
                type="password"
                placeholder={settings.password || "未设置"}
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </Field>
            <p className="settings-hint">
              改密码会立即生效：此前发出的会话全部作废，刷新页面重新输一次即可。
            </p>
            <div className="settings-grid">
              <Field label="监听地址（只读）" hint="局域网访问靠它；改它要写 .env 再重启">
                <input value={settings.bootstrap.host} readOnly />
              </Field>
              <Field label="端口（只读）" hint="改它要写 .env 再重启">
                <input value={String(settings.bootstrap.port)} readOnly />
              </Field>
            </div>
            <Field
              label="数据目录（只读）"
              hint="剧目、素材库、缓存与设置文件都在这里；换目录在 .env 里写 STAGE_DATA_DIR"
            >
              <input value={settings.bootstrap.dataRoot} readOnly />
            </Field>
          </Group>

          {/* 主题设置 */}
          <Group title="主题设置">
            <Field label="界面主题">
              <select
                value={uiMode}
                onChange={(e) => {
                  const val = e.target.value as ThemeMode;
                  setUiMode(val);
                  setThemeMode(UI_MODE_KEY, val);
                }}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Field>
            <Field label="主色">
              <div className="accent-picker">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`accent-swatch accent-${preset.id}${accent.id === preset.id ? " active" : ""}`}
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={accent.id === preset.id}
                    onClick={() => {
                      setAccentState({ ...readAccent(), id: preset.id });
                      setAccent(preset.id);
                    }}
                  />
                ))}
                <label
                  className={`accent-custom${accent.id === "custom" ? " active" : ""}`}
                  title="自己挑一个颜色"
                >
                  <input
                    type="color"
                    value={accent.custom}
                    aria-label="自己挑一个颜色"
                    onChange={(e) => {
                      setAccentState({ id: "custom", custom: e.target.value });
                      setAccent("custom", e.target.value);
                    }}
                  />
                  <span>自由</span>
                </label>
                {accent.custom !== DEFAULT_ACCENT_CUSTOM && (
                  <button
                    type="button"
                    className="ghost-btn accent-reset"
                    onClick={() => {
                      setAccentState({ ...readAccent(), custom: DEFAULT_ACCENT_CUSTOM });
                      setAccent(readAccent().id, DEFAULT_ACCENT_CUSTOM);
                    }}
                  >
                    恢复默认色
                  </button>
                )}
              </div>
            </Field>
            <Field label="舞台主题">
              <select
                value={stageMode}
                onChange={(e) => {
                  const val = e.target.value as ThemeMode;
                  setStageMode(val);
                  setThemeMode(STAGE_MODE_KEY, val);
                }}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Field>
          </Group>

          <div className="row">
            <button className="primary-btn" onClick={() => void save()}>
              保存设置
            </button>
            <button className="ghost-btn" onClick={load}>
              放弃改动
            </button>
            <span className="muted">
              数据目录：{settings.bootstrap.dataRoot}　监听：{settings.bootstrap.host}:{settings.bootstrap.port}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* 其余辅助组件保持不变 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KeyField(props: {
  label: string;
  hint: string;
  value: string;
  masked: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={props.label} hint={props.hint.replace("{count}", String(props.masked.length))}>
      <input
        value={props.value}
        placeholder={props.masked.join("　") || "未配置"}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="settings-field">
      <span className="settings-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="settings-hint">{props.hint}</span>}
    </label>
  );
}

function NumField(props: {
  label: string;
  hint?: string;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-field">
      <span className="settings-label">{props.label}</span>
      <input
        type="number"
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) props.onChange(next);
        }}
      />
      {props.hint && <span className="settings-hint">{props.hint}</span>}
    </label>
  );
}