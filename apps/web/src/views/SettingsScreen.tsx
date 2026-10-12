import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@aivn/stage";
import { api, type GatewayModel, type ImageKind, type Settings } from "../api.js";
import { navigate, settingsReturnFrom } from "../router.jsx";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { ModelSelect, modelSourceHint } from "../ui/ModelSelect.js";
import {
  ACCENT_CHANGED,
  ACCENT_PRESETS,
  DEFAULT_ACCENT_CUSTOM,
  DEFAULT_UI_MODE,
  DIALOG_STYLES,
  DIALOG_STYLE_CHANGED,
  THEME_MODE_CHANGED,
  readAccent,
  readDialogStyle,
  setAccent,
  setDialogStyle,
  setThemeMode,
  type AccentId,
  type DialogStyleId,
  type ThemeMode,
} from "../hooks/useTheme.js";

const UI_MODE_KEY = "aivn:ui-theme-mode";

/** 分区表：左侧导航与右侧 Group 共用一份 id，两边不会漂。顺序 = 页面上的顺序。 */
const SECTIONS = [
  { id: "model", label: "模型网关" },
  { id: "workshop", label: "工坊线程" },
  { id: "image", label: "出图" },
  { id: "music", label: "音乐生成" },
  { id: "voice", label: "语音" },
  { id: "search", label: "联网检索" },
  { id: "access", label: "访问与启动" },
  { id: "lan", label: "局域网访问" },
  { id: "appearance", label: "主题设置" },
] as const;

/** 生图类目的展示顺序与名字（词表与服务端 `IMAGE_KINDS` 同表）。 */
const KIND_ORDER: ImageKind[] = ["background", "cg", "sprite"];
const KIND_TITLES: Record<ImageKind, string> = { background: "背景", cg: "CG", sprite: "立绘" };

/** 页面最后一组：滚到底时高亮它——末尾那组常常落在高亮带之外（见滚动跟随那段）。 */
const LAST_SECTION: string = SECTIONS[SECTIONS.length - 1]!.id;

/** 一类目的覆盖草稿：输入框一律是字符串，空串 = 跟随基础。 */
type ImageKindDraft = {
  format: "" | Settings["image"]["format"];
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  reference: "" | Settings["image"]["reference"];
  timeoutMs: string;
};

function kindDraftOf(over: Settings["image"]["kinds"][ImageKind]): ImageKindDraft {
  return {
    format: over.format ?? "",
    baseUrl: over.baseUrl ?? "",
    apiKey: over.apiKey ?? "",
    model: over.model ?? "",
    size: over.size ?? "",
    reference: over.reference ?? "",
    timeoutMs: over.timeoutMs === undefined ? "" : String(over.timeoutMs),
  };
}

/** 这一格填了几项（摘要上显示「已覆盖 N 项」）。 */
function kindOverrideCount(draft: ImageKindDraft): number {
  return [
    draft.format,
    draft.baseUrl,
    draft.apiKey,
    draft.model,
    draft.size,
    draft.reference,
    draft.timeoutMs,
  ].filter((value) => value !== "").length;
}

function storedMode(key: string, fallback: ThemeMode): ThemeMode {
  const val = localStorage.getItem(key);
  return val === "system" || val === "light" || val === "dark" ? val : fallback;
}

type Draft = {
  password: string;
  lanAccess: boolean;
  model: Settings["model"];
  workshopContext: Settings["workshopContext"];
  beatTimeoutMs: number;
  image: Omit<Settings["image"], "kinds"> & { kinds: Record<ImageKind, ImageKindDraft> };
  music: Settings["music"];
  tts: Omit<Settings["tts"], "keys"> & { keys: string };
  exa: Omit<Settings["exa"], "keys"> & { keys: string };
};

/**
 * 读视图 → 可编辑草稿。
 *
 * 单把凭据（API Key / 访问密码）把**掩码**填进输入框：原样回传 = 服务端判为不改，
 * 清空 = 显式清除，输入新值 = 替换。读视图里已经是掩码，不再二次改写。
 * 多把 key（tts / exa）语义不同：输入框恒空，留空即不改、填入即整组替换。
 */
function draftOf(next: Settings): Draft {
  return {
    password: next.password,
    lanAccess: next.lanAccess,
    model: { ...next.model },
    workshopContext: { ...next.workshopContext },
    beatTimeoutMs: next.beatTimeoutMs,
    image: {
      ...next.image,
      kinds: {
        background: kindDraftOf(next.image.kinds.background),
        cg: kindDraftOf(next.image.kinds.cg),
        sprite: kindDraftOf(next.image.kinds.sprite),
      },
    },
    music: { ...next.music },
    tts: { ...next.tts, keys: "" },
    exa: { ...next.exa, keys: "" },
  };
}

export function SettingsScreen({ search }: { search?: string } = {}) {
  /** 从哪儿进来的：剧目库（缺省）还是某个剧目的标题页。 */
  const backTo = settingsReturnFrom(search);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  /** 保存请求在途：期间禁掉保存键，免得高延迟下连点重复落盘。 */
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<GatewayModel[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  /** 刚复制过的那条局域网地址（按钮上闪一下「已复制」）。 */
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [firewallMsg, setFirewallMsg] = useState<string | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);

  // 主题模式状态：界面主题与主色。舞台没有单独一套深浅，跟界面同一份（见 useTheme.applyTheme）
  const [uiMode, setUiMode] = useState<ThemeMode>(() =>
    storedMode(UI_MODE_KEY, DEFAULT_UI_MODE),
  );
  const [accent, setAccentState] = useState<{ id: AccentId; custom: string }>(
    () => readAccent(),
  );
  const [dialogStyle, setDialogStyleState] = useState<DialogStyleId>(() => readDialogStyle());

  const loadModels = useCallback((refresh = false): void => {
    api
      .agentModels(refresh)
      .then((r) => {
        setModels(r.models);
        setModelError(null);
      })
      .catch((err: unknown) =>
        setModelError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  const load = useCallback(() => {
    api
      .settings()
      .then((next) => {
        setSettings(next);
        setDraft(draftOf(next));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    loadModels();
  }, [loadModels]);

  useEffect(load, [load]);

  // 监听存储变化，以便其他标签页的改动能同步 UI
  useEffect(() => {
    const handleStorage = (e: Event): void => {
      const key = (e as StorageEvent).key;
      if (key === UI_MODE_KEY)
        setUiMode(storedMode(UI_MODE_KEY, DEFAULT_UI_MODE));
      if (key === ACCENT_CHANGED) setAccentState(readAccent());
      if (key === DIALOG_STYLE_CHANGED) setDialogStyleState(readDialogStyle());
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_MODE_CHANGED, handleStorage);
    window.addEventListener(ACCENT_CHANGED, handleStorage);
    window.addEventListener(DIALOG_STYLE_CHANGED, handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_MODE_CHANGED, handleStorage);
      window.removeEventListener(ACCENT_CHANGED, handleStorage);
      window.removeEventListener(DIALOG_STYLE_CHANGED, handleStorage);
    };
  }, []);

  const save = async (): Promise<void> => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const { changed, settings: fresh } = await api.saveSettings(draft);
      setSaved(changed);
      setError(null);
      // 服务端已经就地生效，回传的读视图直接当新基准（凭据掩码也跟着更新）
      setSettings(fresh);
      setDraft(draftOf(fresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /** 保存成功那条是回执，不是状态：几秒后自己收起，不占着页头。 */
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(null), 5000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const copyUrl = (url: string): void => {
    // 非安全上下文（例如手机上直接开局域网 http）里没有 clipboard，地址本身也在页面上可选中
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(url).then(
      () => {
        setCopiedUrl(url);
        window.setTimeout(
          () => setCopiedUrl((current) => (current === url ? null : current)),
          1500,
        );
      },
      () => setCopiedUrl(null),
    );
  };

  const runFirewall = async (): Promise<void> => {
    setFirewallBusy(true);
    try {
      setFirewallMsg((await api.openFirewall()).message);
    } catch (err) {
      setFirewallMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setFirewallBusy(false);
    }
  };

  /** 设置内容很长，左侧导航要指出「现在读到哪一组」，否则那排字只是一堆锚点。 */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    // 滚动跟随只有一个判据：滚动区上沿那条三成高的带里、起点最靠下的那一组
    // （与 IntersectionObserver 的 rootMargin "0 0 -70%" 同义）。不用 observer 是因为
    // 它只在「某组跨过带边」时回调：从底部往回滚一点、又没有任何组跨界时，
    // 高亮会赖在最后一组上不动；scroll 事件没有这个盲区，也顺带不依赖那个 API。
    const sections = SECTIONS.map((section) => ({
      id: section.id,
      el: root.querySelector<HTMLElement>(`#settings-${section.id}`),
    }));
    const sync = (): void => {
      // 滚到底 = 最后一组。末尾那组（主题设置）不足带高，不特判的话到底时导航停在上一组。
      const atBottom =
        root.scrollHeight > root.clientHeight + 2 &&
        root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      if (atBottom) {
        setActiveSection(LAST_SECTION);
        return;
      }
      const bandBottom =
        root.getBoundingClientRect().top + root.clientHeight * 0.3;
      let current = sections[0]?.id ?? LAST_SECTION;
      for (const { id, el } of sections) {
        if (el && el.getBoundingClientRect().top <= bandBottom) current = id;
      }
      setActiveSection(current);
    };
    root.addEventListener("scroll", sync, { passive: true });
    // 收起/展开某一组、转屏都会让各组的落点整体挪位，而滚动位置没变
    window.addEventListener("resize", sync);
    return () => {
      root.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [draft !== null]);

  /** 窄屏收起来的分组（宽屏这条状态不起作用，见 app.css 的 .settings-group-collapsed）。 */
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const toggleGroup = (id: string): void => {
    setCollapsed((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  };

  const goSection = (id: string): void => {
    // 导航点一组，那一组得是展开的——否则滚过去看见的只是一个标题
    setCollapsed((cur) => cur.filter((x) => x !== id));
    bodyRef.current
      ?.querySelector(`#settings-${id}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="screen settings-screen">
      <header className="screen-bar">
        <button className="ghost-btn" onClick={() => navigate(backTo)}>
          <span className="btn-icon">
            <Icon name="back" /> {backTo === "/" ? "剧目库" : "返回"}
          </span>
        </button>
        <h2>设置</h2>
      </header>

      <div className="notice-layer">
        {error && (
          <div className="error-banner" role="alert">
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
        {saved && (
          <div
            className="ok-banner"
            role="status"
            onClick={() => setSaved(null)}
            title="点一下收起"
          >
            <Icon name="check" size={13} />
            <span>
              {saved.length === 0
                ? "没有改动，不用保存。"
                : `已保存并立即生效 ${saved.length} 项：${saved.join("、")}`}
            </span>
            <button
              type="button"
              className="notice-close"
              aria-label="收起这条"
              onClick={() => setSaved(null)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
      </div>
      {!draft || !settings ? (
        <div className="overlay">读取设置…</div>
      ) : (
        <div className="settings-shell">
          <nav className="settings-nav" aria-label="设置分区">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`settings-nav-btn${activeSection === section.id ? " is-active" : ""}`}
                aria-current={activeSection === section.id ? "true" : undefined}
                onClick={() => goSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="settings-body" ref={bodyRef}>
            <Group
              id="model"
              collapsed={collapsed.includes("model")}
              onToggle={() => toggleGroup("model")}
              title="模型网关"
              desc="对话走哪个模型、走哪个网关。"
            >
              <Field
                label="模型 ID"
                hint={modelSourceHint(models ?? [], settings.model.models)}
              >
                <ModelSelect
                  value={draft.model.modelId}
                  models={models}
                  error={modelError}
                  onChange={(id) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, modelId: id },
                    })
                  }
                  onRetry={() => loadModels(true)}
                />
              </Field>
              <Field
                label="限制级（NSFW）专用模型"
                hint="进入限制级剧情时切换至此模型。剧目未单独指定时生效；留空则跟随该剧目主模型。"
              >
                <ModelSelect
                  value={draft.model.nsfwModelId ?? ""}
                  models={models}
                  error={modelError}
                  emptyLabel={`跟随主模型（${draft.model.modelId}）`}
                  onChange={(id) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, nsfwModelId: id },
                    })
                  }
                  onRetry={() => loadModels(true)}
                />
              </Field>
              <Field
                label="限制级专属提示词"
                hint="进入限制级通道时追加到系统提示词末尾；留空则不加。"
              >
                <textarea
                  rows={3}
                  value={draft.model.nsfwPrompt ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, nsfwPrompt: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="支持的模型">
                <input
                  value={draft.model.models}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, models: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="元数据基座">
                <input
                  value={draft.model.modelBase}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, modelBase: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="网关地址">
                <input
                  value={draft.model.baseUrl}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, baseUrl: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label="API Key"
                hint={
                  settings.model.apiKeySet
                    ? `已存 ${settings.model.apiKey}——保持原样即不改，清空 = 删除，输入新值 = 替换`
                    : "尚未配置——不填则播放会 401"
                }
              >
                <input
                  type="password"
                  value={draft.model.apiKey}
                  placeholder={
                    settings.model.apiKeySet
                      ? "清空保存 = 删除这把 key"
                      : "未配置"
                  }
                  onFocus={(e) => e.target.select()}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, apiKey: e.target.value },
                    })
                  }
                />
              </Field>
              <div className="settings-grid">
                <NumField
                  label="输出上限"
                  hint="超过网关限制会返回 400，内容为空"
                  value={draft.model.maxTokens}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, maxTokens: v },
                    })
                  }
                />
                <NumField
                  label="上下文窗口"
                  value={draft.model.contextWindow}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, contextWindow: v },
                    })
                  }
                />
                <NumField
                  label="压缩阈值"
                  hint="占窗口比例 0–1"
                  step={0.05}
                  value={draft.model.compactRatio}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, compactRatio: v },
                    })
                  }
                />
                <NumField
                  label="保留上下文"
                  hint="必须小于压缩阈值"
                  value={draft.model.keepRecentTokens}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      model: { ...draft.model, keepRecentTokens: v },
                    })
                  }
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

            <Group
              id="workshop"
              collapsed={collapsed.includes("workshop")}
              onToggle={() => toggleGroup("workshop")}
              title="工坊线程"
              desc="工坊里跟剧作家聊天用的模型与压缩策略，可以和演出分开。"
            >
              <p className="settings-hint">
                工坊可以和剧作家用不同的模型，压缩阈值因此另有一套；缺省与上面一致。
              </p>
              <div className="settings-grid">
                <NumField
                  label="工坊上下文窗口"
                  value={draft.workshopContext.contextWindow}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      workshopContext: {
                        ...draft.workshopContext,
                        contextWindow: v,
                      },
                    })
                  }
                />
                <NumField
                  label="工坊压缩阈值"
                  hint="占窗口比例 0–1"
                  step={0.05}
                  value={draft.workshopContext.compactRatio}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      workshopContext: {
                        ...draft.workshopContext,
                        compactRatio: v,
                      },
                    })
                  }
                />
                <NumField
                  label="工坊保留上下文"
                  hint="必须小于压缩阈值"
                  value={draft.workshopContext.keepRecentTokens}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      workshopContext: {
                        ...draft.workshopContext,
                        keepRecentTokens: v,
                      },
                    })
                  }
                />
              </div>
            </Group>

            <Group
              id="image"
              collapsed={collapsed.includes("image")}
              onToggle={() => toggleGroup("image")}
              title="出图"
              desc="背景、插图与立绘由哪个生图后端出。"
            >
              <Field label="启用生图">
                <input
                  type="checkbox"
                  checked={draft.image.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      image: { ...draft.image, enabled: e.target.checked },
                    })
                  }
                />
              </Field>
              <Field
                label="接口格式"
                hint="gemini 支持垫图，modelslab 只吃一张，openai 不支持"
              >
                <select
                  value={draft.image.format}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      image: {
                        ...draft.image,
                        format: e.target.value as Settings["image"]["format"],
                      },
                    })
                  }
                >
                  <option value="gemini">gemini</option>
                  <option value="modelslab">modelslab</option>
                  <option value="openai">openai</option>
                </select>
              </Field>
              <Field
                label="生图 Key"
                hint={
                  settings.image.apiKeySet
                    ? `已存 ${settings.image.apiKey}——保持原样即不改，清空 = 删除，输入新值 = 替换`
                    : "尚未配置——出图会被网关拒"
                }
              >
                <input
                  type="password"
                  value={draft.image.apiKey}
                  placeholder={
                    settings.image.apiKeySet
                      ? "清空保存 = 删除这把 key"
                      : "未配置"
                  }
                  onFocus={(e) => e.target.select()}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      image: { ...draft.image, apiKey: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="生图地址" hint="服务根地址，不要带 /v1 或 /v1beta">
                <input
                  value={draft.image.baseUrl}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      image: { ...draft.image, baseUrl: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label="出图模型"
                hint="flow2api 需把画幅档位写进别名，否则画幅被忽略"
              >
                <input
                  value={draft.image.model}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      image: { ...draft.image, model: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label="垫图策略"
                hint="派生立绘差分时是否拿 neutral 定妆照当参考图。关掉差分与定妆照就不是同一个人了；gemini 与 modelslab 格式有效"
              >
                <select
                  value={draft.image.reference}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      image: {
                        ...draft.image,
                        reference: e.target
                          .value as Settings["image"]["reference"],
                      },
                    })
                  }
                >
                  <option value="neutral">neutral（保一致性）</option>
                  <option value="none">none（只文生图，更快）</option>
                </select>
              </Field>
              <div className="settings-grid">
                <Field
                  label="出图档位"
                  hint="1K / 2K / 4K 或字面尺寸（如 1536x1024）"
                >
                  <input
                    value={draft.image.size}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        image: { ...draft.image, size: e.target.value },
                      })
                    }
                  />
                </Field>
                <NumField
                  label="出图并发"
                  value={draft.image.concurrency}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      image: { ...draft.image, concurrency: v },
                    })
                  }
                />
                <NumField
                  label="出图超时 ms"
                  value={draft.image.timeoutMs}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      image: { ...draft.image, timeoutMs: v },
                    })
                  }
                />
              </div>

              <p className="settings-hint settings-kinds-note">
                按类目覆盖：留空 = 跟随基础配置；立绘档位下限 2K（抠底要分辨率）。
              </p>
              {KIND_ORDER.map((kind) => (
                <details className="settings-kind" key={kind}>
                  <summary>
                    {KIND_TITLES[kind]}
                    <span className="muted">
                      {kindOverrideCount(draft.image.kinds[kind]) > 0
                        ? `　已覆盖 ${kindOverrideCount(draft.image.kinds[kind])} 项`
                        : "　跟随基础"}
                    </span>
                  </summary>
                  <KindOverrideFields
                    value={draft.image.kinds[kind]}
                    base={draft.image}
                    onChange={(patch) =>
                      setDraft({
                        ...draft,
                        image: {
                          ...draft.image,
                          kinds: { ...draft.image.kinds, [kind]: { ...draft.image.kinds[kind], ...patch } },
                        },
                      })
                    }
                  />
                </details>
              ))}
            </Group>


            <Group
              id="music"
              collapsed={collapsed.includes("music")}
              onToggle={() => toggleGroup("music")}
              title="音乐生成"
              desc="BGM 与音效由哪个后端生成。"
            >
              <Field
                label="启用音乐生成"
                hint="关掉后工坊不再有「生成 BGM」这一手，只能从资源库导入"
              >
                <input
                  type="checkbox"
                  checked={draft.music.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      music: { ...draft.music, enabled: e.target.checked },
                    })
                  }
                />
              </Field>
              <Field
                label="音乐模型"
                hint="flow2api：flow-music-lyria-3.5 / flow-music-lyria-3-pro / musicfx"
              >
                <input
                  value={draft.music.model}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      music: { ...draft.music, model: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label="音乐 Key"
                hint={
                  draft.music.apiKey
                    ? "已单独设置——留空则回落到「出图 Key」"
                    : settings.image.apiKeySet
                      ? `留空 = 跟出图同一个网关与 Key（当前 ${settings.image.apiKey}）`
                      : "尚未配置——出图那把 Key 也没填"
                }
              >
                <input
                  type="password"
                  value={draft.music.apiKey}
                  placeholder="留空 = 用出图那把"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      music: { ...draft.music, apiKey: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label="音乐地址"
                hint="留空 = 用出图地址。服务根地址，不要带 /v1 或 /v1beta"
              >
                <input
                  value={draft.music.baseUrl}
                  placeholder="留空 = 用出图地址"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      music: { ...draft.music, baseUrl: e.target.value },
                    })
                  }
                />
              </Field>
              <NumField
                label="音乐生成超时 ms"
                value={draft.music.timeoutMs}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    music: { ...draft.music, timeoutMs: v },
                  })
                }
              />
            </Group>

            <Group
              id="voice"
              collapsed={collapsed.includes("voice")}
              onToggle={() => toggleGroup("voice")}
              title="语音"
              desc="台词语音合成用哪家服务、哪些音色。"
            >
              <Field label="启用语音" hint="关掉只影响合成，文字照常">
                <input
                  type="checkbox"
                  checked={draft.tts.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tts: { ...draft.tts, enabled: e.target.checked },
                    })
                  }
                />
              </Field>
              <Field label="服务地址" hint="fish-audio 兼容端点">
                <input
                  value={draft.tts.baseUrl}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tts: { ...draft.tts, baseUrl: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="代理" hint="如 http://127.0.0.1:7890">
                <input
                  value={draft.tts.proxy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tts: { ...draft.tts, proxy: e.target.value },
                    })
                  }
                />
              </Field>
              <NumField
                label="语音并发"
                value={draft.tts.concurrency}
                onChange={(v) =>
                  setDraft({ ...draft, tts: { ...draft.tts, concurrency: v } })
                }
              />
              <KeyField
                label="语音密钥"
                hint="多把 key 轮询；已存 {count} 把（留空=保持不变，填入=整组替换）"
                value={draft.tts.keys}
                masked={settings.tts.masked}
                onChange={(keys) =>
                  setDraft({ ...draft, tts: { ...draft.tts, keys } })
                }
              />
            </Group>

            <Group
              id="search"
              collapsed={collapsed.includes("search")}
              onToggle={() => toggleGroup("search")}
              title="联网检索（Exa）"
              desc="剧作家查资料走哪个检索服务。"
            >
              <Field label="启用检索" hint="关掉后工坊只剩离线工具">
                <input
                  type="checkbox"
                  checked={draft.exa.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      exa: { ...draft.exa, enabled: e.target.checked },
                    })
                  }
                />
              </Field>
              <Field label="服务地址" hint="exa 兼容端点">
                <input
                  value={draft.exa.baseUrl}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      exa: { ...draft.exa, baseUrl: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="代理" hint="如 http://127.0.0.1:7890">
                <input
                  value={draft.exa.proxy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      exa: { ...draft.exa, proxy: e.target.value },
                    })
                  }
                />
              </Field>
              <NumField
                label="检索超时 ms"
                value={draft.exa.timeoutMs}
                onChange={(v) =>
                  setDraft({ ...draft, exa: { ...draft.exa, timeoutMs: v } })
                }
              />
              <KeyField
                label="检索密钥"
                hint="多把 key 轮询；已存 {count} 把（留空=保持不变，填入=整组替换）"
                value={draft.exa.keys}
                masked={settings.exa.masked}
                onChange={(keys) =>
                  setDraft({ ...draft, exa: { ...draft.exa, keys } })
                }
              />
            </Group>

            <Group
              id="access"
              collapsed={collapsed.includes("access")}
              onToggle={() => toggleGroup("access")}
              title="访问与启动"
              desc="端口、数据目录与访问密码。"
            >
              <Field
                label="访问密码"
                hint={
                  settings.passwordSet
                    ? `已开启（HTTP Basic），当前 ${settings.password}——保持原样即不改；清空并保存 = 关闭设防`
                    : "当前没有设防。挂到公网前务必设一个（局域网自用可以不设）"
                }
              >
                <input
                  type="password"
                  placeholder={
                    settings.passwordSet ? "清空保存 = 关闭设防" : "未设置"
                  }
                  value={draft.password}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value })
                  }
                />
              </Field>
              <p className="settings-hint">
                改密码立即生效：此前发出的会话全部作废，刷新页面重新输一次。
              </p>
              <div className="settings-grid">
                <Field
                  label="监听地址（只读）"
                  hint="当前实际在听的地址：由下面的「局域网访问」开关决定；显式写了 --host / STAGE_HOST 时以那个为准"
                >
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

            <Group
              id="lan"
              collapsed={collapsed.includes("lan")}
              onToggle={() => toggleGroup("lan")}
              title="局域网访问"
              desc="手机、平板怎么连到这台机器。"
            >
              <Field
                label="允许局域网访问"
                hint="打开后同一 Wi-Fi 下的手机/平板能连；关着只有本机能连。保存即生效"
              >
                <input
                  type="checkbox"
                  checked={draft.lanAccess}
                  onChange={(e) =>
                    setDraft({ ...draft, lanAccess: e.target.checked })
                  }
                />
              </Field>
              <Field label="手机该连的地址">
                {!settings.lanAccess ? (
                  <span className="muted">打开后这里会显示手机该连的地址</span>
                ) : settings.bootstrap.lanUrls.length === 0 ? (
                  <span className="muted">这台机器没有可用的局域网地址</span>
                ) : (
                  settings.bootstrap.lanUrls.map((url) => (
                    <span className="row" key={url}>
                      <code>{url}</code>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => copyUrl(url)}
                      >
                        {copiedUrl === url ? "已复制" : "复制"}
                      </button>
                    </span>
                  ))
                )}
              </Field>
              <div className="row">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={firewallBusy}
                  onClick={() => void runFirewall()}
                >
                  允许局域网访问（Windows 防火墙）
                </button>
              </div>
              <p className="settings-hint">
                第一次打开开关时系统会弹一次授权，点「允许」就够了。这个按钮是给当时点了「取消」或没弹窗兜底的：需要管理员权限，补一条放行规则。
              </p>
              {firewallMsg && <p className="settings-hint">{firewallMsg}</p>}
            </Group>

            {/* 主题设置 */}
            <Group
              id="appearance"
              collapsed={collapsed.includes("appearance")}
              onToggle={() => toggleGroup("appearance")}
              title="主题设置"
              desc="界面明暗主题、全站主色与消息框风格。"
            >
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
                        setAccentState({
                          id: "custom",
                          custom: e.target.value,
                        });
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
                        setAccentState({
                          ...readAccent(),
                          custom: DEFAULT_ACCENT_CUSTOM,
                        });
                        setAccent(readAccent().id, DEFAULT_ACCENT_CUSTOM);
                      }}
                    >
                      恢复默认色
                    </button>
                  )}
                </div>
              </Field>
              {/* 消息框风格：舞台那条台词条的皮。五种都是引擎 CSS，改了立即生效、
                  只影响这台浏览器——与界面主题同一层，所以也走 localStorage。 */}
              <Field label="消息框风格">
                <select
                  value={dialogStyle}
                  onChange={(e) => {
                    const val = e.target.value as DialogStyleId;
                    setDialogStyleState(val);
                    setDialogStyle(val);
                  }}
                >
                  {DIALOG_STYLES.map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </Field>
            </Group>

            <p className="settings-paths muted">
              数据目录：{settings.bootstrap.dataRoot}　监听：
              {settings.bootstrap.host}:{settings.bootstrap.port}
            </p>
          </div>
        </div>
      )}
      {draft && settings && (
        <div className="settings-footer">
          <button
            className="primary"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存设置"}
          </button>
          <button className="ghost-btn" onClick={load}>
            放弃改动
          </button>
        </div>
      )}
    </div>
  );
}

/* 其余辅助组件保持不变 */
function Group({
  id,
  title,
  desc,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  /** 一句「这一组管什么」。九个组排下来，标题本身说不清边界。 */
  desc?: string;
  /** 窄屏收起了这一组（宽屏不生效）。 */
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  // 折叠开关只属于窄屏：桌面一屏放得下几组，没有可收的东西就别摆开关——
  // 光靠 CSS 收掉箭头不够，键盘仍会停在一枚按不动的按钮上。
  const collapsible = useMediaQuery("(max-width: 900px)");
  return (
    <section
      className={`settings-group${collapsed ? " settings-group-collapsed" : ""}`}
      id={`settings-${id}`}
    >
      <header className="settings-group-head">
        <h3>
          {collapsible && onToggle ? (
            <button
              type="button"
              className="settings-group-toggle"
              aria-expanded={!collapsed}
              onClick={onToggle}
            >
              {title}
              <Icon name="down" size={14} />
            </button>
          ) : (
            title
          )}
        </h3>
        {desc && <p className="settings-group-desc">{desc}</p>}
      </header>
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
    <Field
      label={props.label}
      hint={props.hint.replace("{count}", String(props.masked.length))}
    >
      <input
        value={props.value}
        placeholder={props.masked.join("　") || "未配置"}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * 一类目的 7 个覆盖输入：**留空 = 跟随基础**，placeholder 显示当前继承到的值。
 *
 * 草稿里的值一律是字符串（空串即跟随），保存时原样交给服务端——那边把空串当作「清掉这一格」
 * （见 `config.ts` 的 `mergeKindOverride`）。
 */
function KindOverrideFields(props: {
  value: ImageKindDraft;
  base: Omit<Settings["image"], "kinds">;
  onChange: (patch: Partial<ImageKindDraft>) => void;
}) {
  const { value, base } = props;
  const inherited = (text: string): string => `跟随基础${text ? `（${text}）` : ""}`;
  return (
    <div className="settings-kind-body">
      <Field label="接口格式">
        <select
          value={value.format}
          onChange={(e) => props.onChange({ format: e.target.value as ImageKindDraft["format"] })}
        >
          <option value="">{inherited(base.format)}</option>
          <option value="gemini">gemini</option>
          <option value="modelslab">modelslab</option>
          <option value="openai">openai</option>
        </select>
      </Field>
      <Field label="生图地址">
        <input
          value={value.baseUrl}
          placeholder={inherited(base.baseUrl)}
          onChange={(e) => props.onChange({ baseUrl: e.target.value })}
        />
      </Field>
      <Field
        label="生图 Key"
        hint={value.apiKey ? "掩码——保持原样即不改，清空 = 跟随基础那把" : "留空 = 跟随基础那把"}
      >
        <input
          type="password"
          value={value.apiKey}
          placeholder={inherited(base.apiKeySet ? base.apiKey : "")}
          onFocus={(e) => e.target.select()}
          onChange={(e) => props.onChange({ apiKey: e.target.value })}
        />
      </Field>
      <Field label="出图模型">
        <input
          value={value.model}
          placeholder={inherited(base.model)}
          onChange={(e) => props.onChange({ model: e.target.value })}
        />
      </Field>
      <Field label="出图档位">
        <input
          value={value.size}
          placeholder={inherited(base.size)}
          onChange={(e) => props.onChange({ size: e.target.value })}
        />
      </Field>
      <Field label="垫图策略">
        <select
          value={value.reference}
          onChange={(e) => props.onChange({ reference: e.target.value as ImageKindDraft["reference"] })}
        >
          <option value="">{inherited(base.reference)}</option>
          <option value="neutral">neutral（保一致性）</option>
          <option value="none">none（只文生图，更快）</option>
        </select>
      </Field>
      <Field label="出图超时 ms" hint="立绘走 2K，常需要比背景更宽">
        <input
          inputMode="numeric"
          value={value.timeoutMs}
          placeholder={inherited(String(base.timeoutMs))}
          onChange={(e) => props.onChange({ timeoutMs: e.target.value })}
        />
      </Field>
    </div>
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
