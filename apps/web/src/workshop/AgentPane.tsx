import { useCallback, useEffect, useState } from "react";
import type {
  AgentConfig,
  AgentSettings,
  InjectionRole,
  PlayConfig,
  PromptInjection,
  ThinkingLevel,
} from "@aivn/core";
import { THINKING_LEVELS } from "@aivn/core";
import { api, type AgentCapabilityEntry, type GatewayModel, type PromptPreset } from "../api.js";
import { ModelSelect } from "../ui/ModelSelect.js";
import { Loading } from "../ui/Loading.js";
import { Icon } from "@aivn/stage";
import { useDirtyFlag } from "./dirtyGuard.js";

/**
 * 工坊「Agent」页：这部剧的两个 agent 各自跑什么模型、想多深、能开哪些能力。
 *
 * 三项都是**逐剧目**的（落在 play.json 的 agents 段）：网关按量计费，工坊（长对话）跑便宜模型、
 * 剧作家（要文笔）跑强模型是常态；某部剧不想让 agent 自己花钱生图，也只关这一部。
 *
 * 模型清单来自网关 `/v1/models`（读不到就报错，不静默退化——看到的模型和实际计费的对不上
 * 比报错糟得多）；能力目录与服务端 `createAgentKit` 是同一份数据，界面上关掉的能力在下一轮
 * 就彻底装不进去（提示词里对应的章节也跟着收掉）。界面上不出现任何工具名。
 */

const ROLES: { id: "playwriter" | "workshop"; name: string; placeholder: string }[] = [
  {
    id: "playwriter",
    name: "剧作家",
    placeholder:
      "例：主角的心理活动多写一点，别只写对话；\n每轮结尾留一个悬念，别把冲突在这一轮收干净。",
  },
  {
    id: "workshop",
    name: "搭台助手",
    placeholder:
      "例：背景一律走写实厚涂，别用赛博朋克；\n生成素材的 id 用英文小写。",
  },
];

/** 注入消息的角色：与模型看到的四种消息一一对应，`tool` 是「工具跑过、结果是这样」。 */
const INJECTION_ROLES: { id: InjectionRole; label: string }[] = [
  { id: "system", label: "系统" },
  { id: "user", label: "用户" },
  { id: "assistant", label: "助手" },
  { id: "tool", label: "工具结果" },
];

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  default: "跟随服务商默认",
  off: "不思考",
  low: "浅思考（low）",
  medium: "中思考（medium）",
  high: "深思考（high）",
};

export function AgentPane({ playId }: { playId: string }) {
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  /** 盘上那一份：改没改过由它俩比出来（切页前要拦「还没保存」）。 */
  const [onDisk, setOnDisk] = useState<PlayConfig | null>(null);
  const [models, setModels] = useState<GatewayModel[] | null>(null);
  const [defaultModel, setDefaultModel] = useState("");
  /** 按角色分的能力目录：「结束本轮」只装给剧作家，两张卡列同一份就是骗人。 */
  const [capsByRole, setCapsByRole] = useState<
    Record<string, AgentCapabilityEntry[]>
  >({});
  /** 各角色的默认启用集（服务端给的）：play.json 没写 capabilities 时就是这个。 */
  const [capDefaults, setCapDefaults] = useState<Record<string, string[]>>({});
  const [modelError, setModelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadModels = useCallback((refresh = false): void => {
    api
      .agentModels(refresh)
      .then((r) => {
        setModels(r.models);
        setDefaultModel(r.defaultModel);
        setModelError(null);
      })
      .catch((e: Error) => {
        setModels(null);
        setModelError(e.message);
      });
  }, []);

  useEffect(() => {
    api
      .playDetail(playId)
      .then((d) => {
        setDraft(d.play);
        setOnDisk(d.play);
      })
      .catch((e: Error) => setError(e.message));
    api
      .agentCapabilities()
      .then((r) => {
        setCapsByRole(r.capabilities ?? {});
        setCapDefaults(r.defaults ?? {});
      })
      .catch((e: Error) => setError(e.message));
    loadModels();
  }, [playId, loadModels]);

  const patch = (
    role: "playwriter" | "workshop",
    fn: (settings: AgentSettings) => void,
  ): void => {
    if (!draft) return;
    const next = structuredClone(draft);
    const agents: AgentConfig = next.agents ?? {};
    const settings: AgentSettings = { ...(agents[role] ?? {}) };
    fn(settings);
    // 空设置不留空壳：play.json 里只写用户真的设过的字段
    if (Object.keys(settings).length === 0) delete agents[role];
    else agents[role] = settings;
    next.agents = Object.keys(agents).length > 0 ? agents : undefined;
    setDraft(next);
    setSaved(false);
  };

  /** 上下文注入是 agents 段里的第三个键（不归任何单个角色），所以另开一个改法。 */
  const patchInjection = (fn: (injection: PromptInjection) => void): void => {
    if (!draft) return;
    const next = structuredClone(draft);
    const agents: AgentConfig = next.agents ?? {};
    const injection: PromptInjection = structuredClone(agents.injection ?? {});
    fn(injection);
    const messages = injection.messages ?? [];
    const empty = injection.enabled !== true && messages.length === 0;
    if (empty) delete agents.injection;
    else agents.injection = injection;
    next.agents = Object.keys(agents).length > 0 ? agents : undefined;
    setDraft(next);
    setSaved(false);
  };

  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(onDisk);
  useDirtyFlag("agent", dirty);

  const save = (): void => {
    if (!draft) return;
    api
      .savePlay(draft)
      .then(() => setSaved(true))
      .catch((e: Error) => setError(e.message));
  };

  if (!draft) {
    return (
      <div className="workshop-tab-pane agent-pane">
        {error ? (
          <div className="error-banner small">
            {error}
            <button
              type="button"
              className="notice-close"
              aria-label="收起这条"
              onClick={() => setError(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  return (
    <div className="workshop-tab-pane agent-pane">
      {error && (
        <div className="error-banner small">
          {error}
          <button
            type="button"
            className="notice-close"
            aria-label="收起这条"
            onClick={() => setError(null)}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {ROLES.map((role) => {
        const settings = draft.agents?.[role.id] ?? {};
        const caps = capsByRole[role.id] ?? [];
        const groups = [...new Set(caps.map((c) => c.group))];
        // play.json 没写 capabilities = 走服务端默认；写了就是用户的显式选择，两者在界面上是同一个开关
        const enabled = new Set(
          settings.capabilities ?? capDefaults[role.id] ?? [],
        );
        return (
          <section className="settings-group agent-card" key={role.id}>
            <h3>{role.name}</h3>

            <label className="field">
              <span>模型</span>
              <ModelSelect
                value={settings.model ?? ""}
                models={models}
                error={modelError}
                emptyLabel={`跟随服务端默认${defaultModel ? `（${defaultModel}）` : ""}`}
                onChange={(id) =>
                  patch(role.id, (s) => setOrClear(s, "model", id, ""))
                }
                onRetry={() => loadModels(true)}
              />
            </label>

            <label className="field">
              <span>思考档位</span>
              <select
                value={settings.thinking ?? "default"}
                onChange={(e) =>
                  patch(role.id, (s) =>
                    setOrClear(s, "thinking", e.target.value, "default"),
                  )
                }
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {THINKING_LABEL[level]}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <span>能力</span>
              {groups.length === 0 && (
                <p className="muted small">能力目录读取中…</p>
              )}
              {groups.map((group) => (
                <div className="agent-tool-group" key={group}>
                  <h4>
                    {caps.find((c) => c.group === group)?.groupLabel ?? group}
                  </h4>
                  {caps
                    .filter((c) => c.group === group)
                    .map((cap) => (
                      <label className="switch-row" key={cap.id}>
                        <input
                          type="checkbox"
                          checked={enabled.has(cap.id)}
                          onChange={(e) =>
                            patch(role.id, (s) =>
                              setCapabilityEnabled(
                                s,
                                cap.id,
                                e.target.checked,
                                capDefaults[role.id] ?? [],
                              ),
                            )
                          }
                        />
                        <span>
                          <b>{cap.label}</b>
                          <span className="muted small">{cap.desc}</span>
                          {!cap.available && cap.unavailableNote && (
                            <span className="muted small">
                              {cap.unavailableNote}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                </div>
              ))}
            </div>

            <label className="field">
              <span>补充要求</span>
              <textarea
                rows={6}
                value={settings.prompt ?? ""}
                placeholder={role.placeholder}
                onChange={(e) =>
                  patch(role.id, (s) => setOrClear(s, "prompt", e.target.value))
                }
              />
            </label>
          </section>
        );
      })}

      <InjectionSection
        value={draft.agents?.injection ?? {}}
        onChange={patchInjection}
      />

      <p className="row agent-foot save-row">
        <button className="primary" onClick={save}>
          保存设置
        </button>
        {saved && <span className="muted small">已保存，下一轮生效。</span>}
      </p>
    </div>
  );
}

/**
 * 上下文注入（play.json 的 `agents.injection`）：启用后两个 agent 的上下文开头都先看到这一组消息。
 *
 * 内容随「保存设置」一起落盘；preset 是**应用级**的另一份东西（跨剧目复用），
 * 所以它的存/取/删走自己的接口，与上面那颗保存键互不牵连。
 */
function InjectionSection({
  value,
  onChange,
}: {
  value: PromptInjection;
  onChange: (fn: (injection: PromptInjection) => void) => void;
}) {
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const messages = value.messages ?? [];

  useEffect(() => {
    api
      .promptPresets()
      .then((r) => setPresets(r.presets))
      .catch((e: Error) => setNote(`preset 读取失败：${e.message}`));
  }, []);

  const run = (task: Promise<{ presets: PromptPreset[] }>, done: string): void => {
    task
      .then((r) => {
        setPresets(r.presets);
        setNote(done);
      })
      .catch((e: Error) => setNote(e.message));
  };

  const apply = (msgs: PromptPreset["messages"]): void => {
    onChange((injection) => {
      injection.enabled = true;
      injection.messages = msgs.map((m) => ({ ...m }));
    });
  };

  return (
    <section className="settings-group agent-card">
      <h3>提示词注入</h3>
      <p className="muted small">
        启用后，剧作家与搭台助手的上下文开头都会先看到这组消息，再看到各自的系统提示词与对话。
        它不会写进剧情记录、也不进工坊对话——想换一部剧接着用，就存成 preset。
      </p>

      <label className="switch-row">
        <input
          type="checkbox"
          checked={value.enabled === true}
          onChange={(e) =>
            onChange((injection) => {
              if (e.target.checked) injection.enabled = true;
              else delete injection.enabled;
            })
          }
        />
        <span>
          <b>启用注入</b>
          <span className="muted small">关掉时下面这组内容原样留着，只是不注入。</span>
        </span>
      </label>

      {messages.map((message, index) => (
        <div className="injection-row" key={index}>
          <select
            value={message.role}
            onChange={(e) =>
              onChange((injection) => {
                const target = injection.messages?.[index];
                if (target) target.role = e.target.value as InjectionRole;
              })
            }
          >
            {INJECTION_ROLES.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={message.text}
            onChange={(e) =>
              onChange((injection) => {
                const target = injection.messages?.[index];
                if (target) target.text = e.target.value;
              })
            }
          />
          <button
            type="button"
            className="ghost-btn danger-btn"
            onClick={() =>
              onChange((injection) => {
                injection.messages = (injection.messages ?? []).filter(
                  (_, i) => i !== index,
                );
              })
            }
          >
            删除
          </button>
        </div>
      ))}

      <p className="row">
        <button
          type="button"
          className="ghost-btn"
          onClick={() =>
            onChange((injection) => {
              injection.messages = [
                ...(injection.messages ?? []),
                { role: "system", text: "" },
              ];
            })
          }
        >
          添加一条
        </button>
      </p>

      <div className="injection-preset">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">选择 preset…</option>
          {presets.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ghost-btn"
          disabled={picked === ""}
          onClick={() => {
            const preset = presets.find((p) => p.name === picked);
            if (!preset) return;
            apply(preset.messages);
            setNote(`已载入「${preset.name}」，记得保存设置。`);
          }}
        >
          载入
        </button>
        <button
          type="button"
          className="ghost-btn danger-btn"
          disabled={picked === ""}
          onClick={() => {
            run(api.removePromptPreset(picked), `已删除「${picked}」。`);
            setPicked("");
          }}
        >
          删除
        </button>
        <input
          className="small-input injection-preset-name"
          value={name}
          placeholder="新 preset 的名字"
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="ghost-btn"
          disabled={name.trim() === "" || messages.length === 0}
          onClick={() => {
            const presetName = name.trim();
            run(
              api.savePromptPreset(presetName, messages),
              `已存为「${presetName}」。`,
            );
            setName("");
          }}
        >
          保存为 preset
        </button>
      </div>
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}

/** 值等于默认（或空）时把键删掉，别在 play.json 里留一堆等价于缺省的字段。 */
function setOrClear<
  K extends "model" | "thinking" | "prompt",
>(settings: AgentSettings, key: K, value: string, blank?: string): void {
  // 提示词是长文本，清空后多半只剩几个换行：只判空串会把它当成「用户真的写了内容」存进 play.json，
  // 服务端读回时又因 trim 为空丢掉——文件里留了一段永不生效的文本。
  if (value.trim() === "" || value === blank) delete settings[key];
  else settings[key] = value as AgentSettings[K];
}

function setCapabilityEnabled(
  settings: AgentSettings,
  capabilityId: string,
  enabled: boolean,
  defaults: readonly string[],
): void {
  const set = new Set(settings.capabilities ?? defaults);
  if (enabled) set.add(capabilityId);
  else set.delete(capabilityId);
  settings.capabilities = [...set].sort();
}
