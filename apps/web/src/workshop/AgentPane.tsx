import { useCallback, useEffect, useState } from "react";
import type { AgentConfig, AgentSettings, PlayConfig, ThinkingLevel } from "@stage-ai/core";
import { THINKING_LEVELS } from "@stage-ai/core";
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

const ROLES: { id: keyof AgentConfig; name: string; blurb: string }[] = [
  {
    id: "playwriter",
    name: "剧作家",
    blurb: "演出中实时写剧本的那个。每轮都要出文，模型与思考档位对成品质感影响最大。",
  },
  {
    id: "workshop",
    name: "搭台助手",
    blurb: "在工坊里改设定、补素材、翻故事树的那个。对话轮次多、单轮简单，便宜模型通常够用。",
  },
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
  const [tools, setTools] = useState<AgentToolEntry[]>([]);
  /** 各角色的默认启用集（服务端给的）：play.json 没写 tools 时就是这个。 */
  const [toolDefaults, setToolDefaults] = useState<Record<string, string[]>>({});
  const [modelError, setModelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const loadModels = useCallback(
    (refresh = false): void => {
      setLoadingModels(true);
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
        })
        .finally(() => setLoadingModels(false));
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
        setTools(r.tools);
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
        const groups = [...new Set(tools.map((t) => t.group))];
        // play.json 没写 tools = 走服务端默认；写了就是用户的显式选择，两者在界面上是同一个开关
        const enabled = new Set(settings.tools ?? toolDefaults[role.id] ?? []);
        return (
          <section className="settings-group agent-card" key={role.id}>
            <h3>{role.name}</h3>
            <p className="muted small">{role.blurb}</p>

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
              <p className="muted small">
                网关按量计费：工坊跑便宜模型、剧作家跑强模型是常见配法。
                {loadingModels && " 正在读模型清单…"}
              </p>
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
              <p className="muted small">调高会让模型先想再写，代价是每轮更慢也更贵。默认不思考。</p>
            </label>

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
              <p className="muted small">
                关掉的工具下一轮就装不进去（模型看不见它，提示词里对应的章节也一起收掉）。改完从下一轮生效。
                没勾的会写进 play.json，与默认集无关——默认只是初始态。
              </p>
            </div>
          </section>
        );
      })}

      <p className="row agent-foot">
        <button className="primary" onClick={save}>
          保存设置
        </button>
        {saved && <span className="muted small">已保存。演出或工坊对话的下一轮生效，当前这轮不打断。</span>}
      </p>
    </div>
  );
}

/** 值等于默认（或空）时把键删掉，别在 play.json 里留一堆等价于缺省的字段。 */
function setOrClear<K extends "model" | "thinking">(
  settings: AgentSettings,
  key: K,
  value: string,
  blank?: string,
): void {
  if (value === "" || value === blank) delete settings[key];
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
