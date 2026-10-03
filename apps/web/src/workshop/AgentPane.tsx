import { useCallback, useEffect, useState } from "react";
import type { AgentConfig, AgentSettings, PlayConfig, ThinkingLevel } from "@aivn/core";
import { THINKING_LEVELS } from "@aivn/core";
import { api, type AgentToolEntry, type GatewayModel } from "../api.js";
import { ModelSelect } from "../ui/ModelSelect.js";

/**
 * 工坊「Agent」页：这部剧的两个 agent 各自跑什么模型、想多深、能用哪些工具。
 *
 * 三项都是**逐剧目**的（落在 play.json 的 agents 段）：网关按量计费，工坊（长对话）跑便宜模型、
 * 剧作家（要文笔）跑强模型是常态；某部剧不想让 agent 自己花钱生图，也只关这一部。
 *
 * 模型清单来自网关 `/v1/models`（读不到就报错，不静默退化——看到的模型和实际计费的对不上
 * 比报错糟得多）；工具目录与服务端 `createAgentKit` 是同一份数据，界面上关掉的工具在下一轮
 * 就彻底装不进去（提示词里对应的章节也跟着收掉）。
 */

const ROLES: { id: keyof AgentConfig; name: string }[] = [
  { id: "playwriter", name: "剧作家" },
  { id: "workshop", name: "搭台助手" },
];

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "不思考",
  low: "浅思考（low）",
  medium: "中思考（medium）",
  high: "深思考（high）",
};

export function AgentPane({ playId }: { playId: string }) {
  const [draft, setDraft] = useState<PlayConfig | null>(null);
  const [models, setModels] = useState<GatewayModel[] | null>(null);
  const [defaultModel, setDefaultModel] = useState("");
  /** 按角色分的工具目录：`beat_done` 只装给剧作家，两张卡列同一份就是骗人。 */
  const [toolsByRole, setToolsByRole] = useState<Record<string, AgentToolEntry[]>>({});
  /** 各角色的默认启用集（服务端给的）：play.json 没写 tools 时就是这个。 */
  const [toolDefaults, setToolDefaults] = useState<Record<string, string[]>>({});
  const [modelError, setModelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadModels = useCallback(
    (refresh = false): void => {
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
    },
    [],
  );

  useEffect(() => {
    api
      .playDetail(playId)
      .then((d) => setDraft(d.play))
      .catch((e: Error) => setError(e.message));
    api
      .agentTools()
      .then((r) => {
        setToolsByRole(r.tools ?? {});
        setToolDefaults(r.defaults ?? {});
      })
      .catch((e: Error) => setError(e.message));
    loadModels();
  }, [playId, loadModels]);

  const patch = (role: keyof AgentConfig, fn: (settings: AgentSettings) => void): void => {
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
        {error ? <div className="error-banner small">{error}</div> : <p className="muted small">读取剧目设置…</p>}
      </div>
    );
  }

  return (
    <div className="workshop-tab-pane agent-pane">
      {error && <div className="error-banner small">{error}</div>}

      {ROLES.map((role) => {
        const settings = draft.agents?.[role.id] ?? {};
        const tools = toolsByRole[role.id] ?? [];
        const groups = [...new Set(tools.map((t) => t.group))];
        // play.json 没写 tools = 走服务端默认；写了就是用户的显式选择，两者在界面上是同一个开关
        const enabled = new Set(settings.tools ?? toolDefaults[role.id] ?? []);
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
                onChange={(id) => patch(role.id, (s) => setOrClear(s, "model", id, ""))}
                onRetry={() => loadModels(true)}
              />
            </label>

            <label className="field">
              <span>思考档位</span>
              <select
                value={settings.thinking ?? "off"}
                onChange={(e) => patch(role.id, (s) => setOrClear(s, "thinking", e.target.value, "off"))}
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {THINKING_LABEL[level]}
                  </option>
                ))}
              </select>
            </label>

            {role.id === "playwriter" && (
              <>
                <label className="field">
                  <span>限制级（NSFW）专用模型</span>
                  <ModelSelect
                    value={settings.nsfwModel ?? ""}
                    models={models}
                    error={modelError}
                    emptyLabel={`跟随剧作家主模型${settings.model ? `（${settings.model}）` : ""}`}
                    onChange={(id) => patch(role.id, (s) => setOrClear(s, "nsfwModel", id, ""))}
                    onRetry={() => loadModels(true)}
                  />
                  <p className="muted small">
                    当剧作家调用 enter_nsfw 进入亲密/限制级剧情时切换为此模型执笔。退出时切回主模型并注入 SFW 摘要。
                  </p>
                </label>

                <label className="field">
                  <span>限制级（NSFW）思考档位</span>
                  <select
                    value={settings.nsfwThinking ?? "off"}
                    onChange={(e) => patch(role.id, (s) => setOrClear(s, "nsfwThinking", e.target.value, "off"))}
                  >
                    {THINKING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {THINKING_LABEL[level]}
                      </option>
                    ))}
                  </select>
                  <p className="muted small">限制级剧情通道下的独立思考档位。默认不思考。</p>
                </label>
              </>
            )}

            <div className="field">
              <span>工具</span>
              {groups.length === 0 && <p className="muted small">工具目录读取中…</p>}
              {groups.map((group) => (
                <div className="agent-tool-group" key={group}>
                  <h4>{tools.find((t) => t.group === group)?.groupLabel ?? group}</h4>
                  {tools
                    .filter((t) => t.group === group)
                    .map((tool) => (
                      <label className="switch-row" key={tool.id}>
                        <input
                          type="checkbox"
                          checked={enabled.has(tool.id)}
                          onChange={(e) =>
                            patch(role.id, (s) =>
                              setToolEnabled(s, tool.id, e.target.checked, toolDefaults[role.id] ?? []),
                            )
                          }
                        />
                        <span>
                          <b>{tool.label}</b>
                          <span className="muted small">{tool.id}</span>
                        </span>
                      </label>
                    ))}
                </div>
              ))}
            </div>

            {role.id === "workshop" && (
              <label className="field">
                <span>补充要求</span>
                <textarea
                  rows={6}
                  value={settings.prompt ?? ""}
                  placeholder={"例：这部作品是慢热悬疑，每轮别写太长；\n涉及凶案的情节先问我一句再写。"}
                  onChange={(e) => patch(role.id, (s) => setOrClear(s, "prompt", e.target.value))}
                />
              </label>
            )}
          </section>
        );
      })}

      <p className="row agent-foot">
        <button className="primary" onClick={save}>
          保存设置
        </button>
        {saved && <span className="muted small">已保存，下一轮生效。</span>}
      </p>
    </div>
  );
}

/** 值等于默认（或空）时把键删掉，别在 play.json 里留一堆等价于缺省的字段。 */
function setOrClear<K extends "model" | "thinking" | "prompt" | "nsfwModel" | "nsfwThinking" | "nsfwPrompt">(
  settings: AgentSettings,
  key: K,
  value: string,
  blank?: string,
): void {
  // 提示词是长文本，清空后多半只剩几个换行：只判空串会把它当成「用户真的写了内容」存进 play.json，
  // 服务端读回时又因 trim 为空丢掉——文件里留了一段永不生效的文本。
  if (value.trim() === "" || value === blank) delete settings[key];
  else settings[key] = value as AgentSettings[K];
}

function setToolEnabled(
  settings: AgentSettings,
  toolId: string,
  enabled: boolean,
  defaults: readonly string[],
): void {
  const set = new Set(settings.tools ?? defaults);
  if (enabled) set.add(toolId);
  else set.delete(toolId);
  settings.tools = [...set].sort();
}
