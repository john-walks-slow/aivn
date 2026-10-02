/**
 * 设置面板（P6）：模型网关 / 出图 / 语音 / 联网四组，全部 GUI 可改。
 *
 * 落点是服务端 `.env`（configApi 负责逐键回写）——用户不碰配置文件。
 * 改完需要重启服务端才生效，面板显式说明，不假装热生效。
 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { api, type GatewayModel, type Settings } from "../api.js";
import { navigate } from "../router.jsx";
import { ModelSelect, modelSourceHint } from "../ui/ModelSelect.js";
import {
  readThemeMode,
  writeThemeMode,
  type ThemeMode,
  STAGE_THEME_KEY,
  UI_THEME_KEY,
} from "../hooks/useTheme.js";

type Draft = {
  model: Settings["model"];
  image: Settings["image"];
  tts: Omit<Settings["tts"], "keys"> & { keys: string };
  exa: Omit<Settings["exa"], "keys"> & { keys: string };
};

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [models, setModels] = useState<GatewayModel[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  // 主题偏好走 useTheme 那套读写（localStorage 键名只此一处定义）
  const [uiMode, setUiMode] = useState<ThemeMode>(() => readThemeMode(UI_THEME_KEY));
  const [stageMode, setStageMode] = useState<ThemeMode>(() => readThemeMode(STAGE_THEME_KEY));

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
        setDraft({
          model: { ...next.model },
          image: { ...next.image },
          tts: { ...next.tts, keys: "" },
          exa: { ...next.exa, keys: "" },
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    loadModels();
  }, [loadModels]);

  useEffect(load, [load]);

  // 别的标签页改了偏好，本页的下拉要跟着变，否则两处显示不一致
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === UI_THEME_KEY) setUiMode(readThemeMode(UI_THEME_KEY));
      if (e.key === STAGE_THEME_KEY) setStageMode(readThemeMode(STAGE_THEME_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = async (): Promise<void> => {
    if (!draft) return;
    try {
      const { changed } = await api.saveSettings(draft);
      setSaved(changed);
      setError(null);
      load();
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
        <span className="muted">改动写回服务端 .env，重启服务端后生效</span>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="warn-banner" role="status" onClick={() => setSaved(null)}>
          已写入 {saved.length} 项：{saved.join("、")}（重启服务端生效）
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
            <Field
              label="支持的模型"
              hint="逗号分隔，上面那个下拉与剧目「Agent」页的下拉都只给这几个；留空 = 网关有什么给什么"
            >
              <input
                value={draft.model.models}
                onChange={(e) => setDraft({ ...draft, model: { ...draft.model, models: e.target.value } })}
              />
            </Field>
            <Field label="元数据基座" hint="决定上下文/价格估算的假模型，必须与网关实际能力匹配">
              <input
                value={draft.model.modelBase}
                onChange={(e) => setDraft({ ...draft, model: { ...draft.model, modelBase: e.target.value } })}
              />
            </Field>
            <Field label="网关地址" hint="OpenAI 兼容端点">
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
                hint="按网关实际限制填"
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
            </div>
          </Group>

          <Group title="出图">
            <Field label="启用生图" hint="关闭后场景只走氛围底色，不占出图配额">
              <input
                type="checkbox"
                checked={draft.image.enabled}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, enabled: e.target.checked } })}
              />
            </Field>
            <Field
              label="接口格式"
              hint="gemini = /v1beta 原生端点，垫图走这里（工坊立绘差分靠它保角色一致性）；openai = /v1/images/generations，不吃垫图"
            >
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
            <Field
              label="生图地址"
              hint="服务根地址，别带 /v1 或 /v1beta（版本段按格式自己拼）。本机 flow2api = http://127.0.0.1:38000，cpa = http://127.0.0.1:9999"
            >
              <input
                value={draft.image.baseUrl}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, baseUrl: e.target.value } })}
              />
            </Field>
            <Field
              label="出图模型"
              hint="按格式填。flow2api 必须把画幅档位写进别名（gemini-3.1-flash-image-landscape-2k 这种），填裸模型名画幅会被静默忽略"
            >
              <input
                value={draft.image.model}
                onChange={(e) => setDraft({ ...draft, image: { ...draft.image, model: e.target.value } })}
              />
            </Field>
            <div className="settings-grid">
              <Field label="出图档位" hint="1K / 2K / 4K = 总像素量级（K 大写），openai 格式按画幅换算成 WxH；也可直接写字面尺寸如 1536x1024">
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
            <Field label="启用语音" hint="关掉不合成也不占配额；文字永远先行，语音不阻塞剧情">
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
            <Field label="代理" hint="本机走 代理 混合端口，如 http://127.0.0.1:7890">
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
            <Field label="启用检索" hint="工坊 agent 唯一的联网口子；关掉就只剩离线工具">
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
            <Field label="代理" hint="本机走 代理 混合端口，如 http://127.0.0.1:7890">
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

          <Group title="主题">
            <Field label="界面主题" hint="剧目库 / 标题 / 周目 / 工坊 / 设置这一层的亮暗">
              <select
                value={uiMode}
                onChange={(e) => {
                  const mode = e.target.value as ThemeMode;
                  setUiMode(mode);
                  writeThemeMode(UI_THEME_KEY, mode);
                }}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </Field>
            <Field label="舞台主题" hint="画面 / 台词条 / 选肢卡这一层的亮暗，与界面互不影响">
              <select
                value={stageMode}
                onChange={(e) => {
                  const mode = e.target.value as ThemeMode;
                  setStageMode(mode);
                  writeThemeMode(STAGE_THEME_KEY, mode);
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
            <span className="muted">剧目库：{settings.playsRoot}　服务端口：{settings.port}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * 多把 key 的凭据输入框。
 *
 * 输入框**永远是空的**，已存的 key 只以掩码出现在 placeholder 里：
 * 「留空 = 不变」只有输入框真的是空的时候才成立，预填掩码再让用户去删是事故的配方。
 */
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
