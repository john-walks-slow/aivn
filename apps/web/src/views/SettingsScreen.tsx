/**
 * 设置面板（P6）：模型网关 / 出图 / 语音三组，全部 GUI 可改。
 *
 * 落点是服务端 `.env` 与 TTS keys 文件（configApi 负责逐键回写）——用户不碰配置文件。
 * 改完需要重启服务端才生效，面板显式说明，不假装热生效。
 */
import { useCallback, useEffect, useState } from "react";
import { api, type Settings, type TtsKeys } from "../api.js";
import { navigate } from "../router.jsx";

type Draft = {
  model: Settings["model"];
  image: Settings["image"];
  flow: Settings["flow"];
  tts: Omit<Settings["tts"], "keyCount">;
};

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [keys, setKeys] = useState<TtsKeys | null>(null);
  const [keyDraft, setKeyDraft] = useState("");

  const load = useCallback(() => {
    api
      .settings()
      .then((next) => {
        setSettings(next);
        setDraft({
          model: { ...next.model },
          image: { ...next.image },
          flow: { ...next.flow },
          tts: {
            enabled: next.tts.enabled,
            keysPath: next.tts.keysPath,
            proxy: next.tts.proxy,
            baseUrl: next.tts.baseUrl,
            concurrency: next.tts.concurrency,
          },
        });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    api
      .ttsKeys()
      .then(setKeys)
      .catch(() => setKeys(null));
  }, []);

  useEffect(load, [load]);

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

  const saveKeys = async (): Promise<void> => {
    const list = keyDraft
      .split(/[\n,]/)
      .map((k) => k.trim())
      .filter(Boolean);
    try {
      await api.saveTtsKeys(list);
      setKeyDraft("");
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
          ← 剧目库
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
            <Field label="模型 ID" hint="cpa 网关的模型名；低端机可用 low / medium 别名">
              <input
                value={draft.model.modelId}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, modelId: e.target.value } })
                }
              />
            </Field>
            <Field label="元数据基座" hint="决定上下文/价格估算的假模型，必须与网关实际能力匹配">
              <input
                value={draft.model.modelBase}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, modelBase: e.target.value } })
                }
              />
            </Field>
            <Field label="网关地址" hint="OpenAI 兼容端点">
              <input
                value={draft.model.baseUrl}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, baseUrl: e.target.value } })
                }
              />
            </Field>
            <Field
              label="API Key"
              hint={
                settings.model.apiKeySet
                  ? "留空或保持掩码即不改；输入新值即替换"
                  : "尚未配置——不填则演出会 401"
              }
            >
              <input
                type="password"
                placeholder={settings.model.apiKey || "未配置"}
                onChange={(e) =>
                  setDraft({ ...draft, model: { ...draft.model, apiKey: e.target.value } })
                }
              />
            </Field>
            <div className="settings-grid">
              <NumField
                label="输出上限"
                hint="超过网关限制即 400 空拍"
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
                onChange={(v) =>
                  setDraft({ ...draft, model: { ...draft.model, keepRecentTokens: v } })
                }
              />
            </div>
          </Group>

          <Group title="出图">
            <Field
              label="启用生图"
              hint="关闭后场景只走氛围底色，不占出图配额"
            >
              <input
                type="checkbox"
                checked={draft.image.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, image: { ...draft.image, enabled: e.target.checked } })
                }
              />
            </Field>
            <Field
              label="出图后端"
              hint="cpa = 通用网关（只能文生图）；flow2api = 本机 Google Flow 网关（支持垫图，工坊立绘差分靠它保角色一致性）"
            >
              <select
                value={draft.image.backend}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    image: { ...draft.image, backend: e.target.value as Settings["image"]["backend"] },
                  })
                }
              >
                <option value="cpa">cpa</option>
                <option value="flow2api">flow2api</option>
              </select>
            </Field>
            {draft.image.backend === "flow2api" ? (
              <>
                <Field
                  label="flow2api Key"
                  hint={
                    settings.flow.apiKeySet
                      ? "留空或保持掩码即不改；输入新值即替换"
                      : "尚未配置——工坊出图会被网关拒"
                  }
                >
                  <input
                    type="password"
                    placeholder={settings.flow.apiKey || "未配置"}
                    onChange={(e) =>
                      setDraft({ ...draft, flow: { ...draft.flow, apiKey: e.target.value } })
                    }
                  />
                </Field>
                <Field label="flow2api 地址" hint="本机网关默认 http://127.0.0.1:38000">
                  <input
                    value={draft.flow.baseUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, flow: { ...draft.flow, baseUrl: e.target.value } })
                    }
                  />
                </Field>
                <Field
                  label="flow2api 模型"
                  hint="必须填别名：gemini-3.1-flash-image | gemini-3.0-pro-image | imagen-4.0-generate-preview。填完整模型名画幅会被静默忽略"
                >
                  <input
                    value={draft.flow.model}
                    onChange={(e) =>
                      setDraft({ ...draft, flow: { ...draft.flow, model: e.target.value } })
                    }
                  />
                </Field>
                <div className="settings-grid">
                  <Field label="出图档位" hint="1k / 2k / 4k；flash-image 只支持 2k 与 4k">
                    <input
                      value={draft.flow.size}
                      onChange={(e) =>
                        setDraft({ ...draft, flow: { ...draft.flow, size: e.target.value } })
                      }
                    />
                  </Field>
                  <NumField
                    label="出图超时 ms"
                    value={draft.flow.timeoutMs}
                    onChange={(v) => setDraft({ ...draft, flow: { ...draft.flow, timeoutMs: v } })}
                  />
                </div>
              </>
            ) : (
              <>
                <Field
                  label="出图模型"
                  hint="gpt-image-2（images/generations）| gemini-3.1-flash-image（流式）"
                >
                  <input
                    value={draft.image.model}
                    onChange={(e) =>
                      setDraft({ ...draft, image: { ...draft.image, model: e.target.value } })
                    }
                  />
                </Field>
                <Field label="尺寸" hint="换 seedream-5.0-lite 需 ≥ 3686400 像素，如 2560x1440">
                  <input
                    value={draft.image.size}
                    onChange={(e) =>
                      setDraft({ ...draft, image: { ...draft.image, size: e.target.value } })
                    }
                  />
                </Field>
              </>
            )}
            <div className="settings-grid">
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
            <Field label="启用语音" hint="关掉不合成也不占配额；文字永远先行，语音不阻塞演出">
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
            <Field
              label="密钥文件"
              hint="多把 key 轮询；当前已存 {count} 把"
              count={keys?.count ?? settings.tts.keyCount}
            >
              <input
                value={draft.tts.keysPath}
                onChange={(e) => setDraft({ ...draft, tts: { ...draft.tts, keysPath: e.target.value } })}
              />
            </Field>
            <Field label="新增密钥" hint="粘贴 key（逗号或换行分隔），点「写入密钥」覆盖整个文件">
              <textarea
                rows={2}
                value={keyDraft}
                placeholder="sk-xxxx, sk-yyyy"
                onChange={(e) => setKeyDraft(e.target.value)}
              />
            </Field>
            <div className="row">
              <button className="ghost-btn" onClick={() => void saveKeys()}>
                写入密钥
              </button>
              {keys && keys.count > 0 && (
                <span className="muted">已存：{keys.keys.map((k) => `${k}••••`).join("　")}</span>
              )}
            </div>
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

function Field(props: {
  label: string;
  hint?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="settings-hint">{props.hint.replace("{count}", String(props.count ?? 0))}</span>}
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
