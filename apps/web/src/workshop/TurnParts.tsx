import { useState } from "react";
import type { WorkshopAssetView, WorkshopPart, WorkshopToolPart } from "@aivn/core";
import type { LightboxImage } from "../ui/ImageLightbox.js";
import { Icon } from "@aivn/stage";
import { AssetStrip } from "./AssetStrip.js";
import { WorkshopMarkdown } from "./WorkshopMarkdown.js";

/** 工具 id → 界面上的中文名。没登记的直接显示 id：新工具忘了登记时看得见，而不是一片空白。 */
const TOOL_LABEL: Record<string, string> = {
  read: "读取文件",
  write: "写入文件",
  edit: "定点编辑",
  bash: "跑命令",
  get_readiness: "检查就绪条件",
  generate_image: "出图",
  recut_sprite: "重抠立绘底",
  list_library: "查素材资源库",
  import_asset: "从资源库导入素材",
  view_image: "看图",
  read_skill: "读技能库",
  list_saves: "查看周目",
  read_lineage: "读故事树",
  web_search: "联网检索",
  search_archive: "搜历史切片",
  set_craft: "改写作参数",
};

/** 一行里能看见的那点参数：路径、命令、查询词。完整参数在展开态里。 */
export function toolSummary(name: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;
  /** 取第一个非空的字符串字段（数组按逗号接起来）。 */
  const text = (...keys: string[]): string => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (Array.isArray(value)) {
        const parts = value.filter((item): item is string => typeof item === "string");
        if (parts.length > 0) return parts.join(", ");
      }
    }
    return "";
  };
  switch (name) {
    case "read":
    case "write":
    case "edit":
      return text("path", "file_path");
    case "bash":
      return firstLine(text("command"));
    case "generate_image":
      return truncate(text("prompt"), 48);
    case "recut_sprite":
      return [text("characterId"), text("expression")].filter(Boolean).join(" · ");
    case "list_library":
      return [text("kind"), text("query")].filter(Boolean).join(" · ");
    case "import_asset":
      return [text("kind"), text("entryId")].filter(Boolean).join(" · ");
    case "web_search":
    case "search_archive":
      return text("query");
    case "view_image":
      return text("source", "path", "url");
    case "read_skill":
    case "read_lineage":
    case "list_saves":
      return text("name", "id", "saveId");
    default: {
      // 兜底：第一个短字符串字段，多半就是这句话的主语
      for (const value of Object.values(record)) {
        if (typeof value === "string" && value.trim() !== "" && value.length <= 80) return value.trim();
      }
      return "";
    }
  }
}

export interface TurnPartsProps {
  parts: WorkshopPart[];
  /** 本轮流式中（思考默认展开，收束后自动折回一行）。 */
  live: boolean;
  onOpenMarkdown: (images: LightboxImage[], index: number) => void;
  onOpenAssets: (assets: WorkshopAssetView[], index: number) => void;
}

/**
 * 一轮回复的段落流：正文照旧走 markdown 气泡，思考与工具各占一行、点开才铺开。
 * 展开态记在这一份段落里——用户手动折过就听用户的，换一条消息是另一份。
 */
export function TurnParts({ parts, live, onOpenMarkdown, onOpenAssets }: TurnPartsProps) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const open = (id: string, fallback: boolean): boolean => toggled[id] ?? fallback;
  const flip = (id: string, fallback: boolean): void =>
    setToggled((prev) => ({ ...prev, [id]: !(prev[id] ?? fallback) }));

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div key={`text-${i}`} className="chat-bubble chat-assistant">
              <WorkshopMarkdown text={part.text} onOpen={onOpenMarkdown} />
            </div>
          );
        }
        if (part.type === "thinking") {
          const id = `think-${i}`;
          const expanded = open(id, live);
          return (
            <div key={id} className={`turn-row thinking${expanded ? " open" : ""}`}>
              <button
                type="button"
                className="turn-row-head"
                aria-expanded={expanded}
                onClick={() => flip(id, live)}
              >
                <Icon name={expanded ? "up" : "down"} size={13} />
                <span className="turn-row-label">思考</span>
                {!expanded && <span className="turn-row-preview">{firstLine(part.text)}</span>}
              </button>
              {expanded && <div className="thinking-body">{part.text}</div>}
            </div>
          );
        }
        const fallback = (part.assets?.length ?? 0) > 0;
        return (
          <ToolRow
            key={part.id}
            part={part}
            expanded={open(part.id, fallback)}
            onToggle={() => flip(part.id, fallback)}
            onOpenAssets={onOpenAssets}
          />
        );
      })}
    </>
  );
}

/** 一次工具调用：一行名字 + 参数摘要 + 状态，点开是参数、结果、以及这次调用产出的素材。 */
function ToolRow({
  part,
  expanded,
  onToggle,
  onOpenAssets,
}: {
  part: WorkshopToolPart;
  expanded: boolean;
  onToggle: () => void;
  onOpenAssets: (assets: WorkshopAssetView[], index: number) => void;
}) {
  const label = TOOL_LABEL[part.name] ?? part.name;
  const summary = toolSummary(part.name, part.args);
  const running = part.result === undefined;
  return (
    <div className={`turn-row tool${expanded ? " open" : ""}${part.isError ? " failed" : ""}`}>
      <button type="button" className="turn-row-head" aria-expanded={expanded} onClick={onToggle}>
        <Icon name={expanded ? "up" : "down"} size={13} />
        <span className="turn-row-label">{label}</span>
        {summary !== "" && <span className="turn-row-preview">{summary}</span>}
        <span className="turn-row-status">
          {running ? <span className="turn-row-running">…</span> : part.isError ? "✗" : "✓"}
          {part.ms !== undefined && part.ms > 0 && <span className="turn-row-ms">{formatMs(part.ms)}</span>}
        </span>
      </button>
      {expanded && (
        <div className="tool-body">
          <ToolArgs args={part.args} />
          {part.result !== undefined && part.result !== "" && <pre className="tool-result">{part.result}</pre>}
          {part.assets && part.assets.length > 0 && <AssetStrip assets={part.assets} onOpen={onOpenAssets} />}
        </div>
      )}
    </div>
  );
}

/** 参数逐项列出来（不是一整块 JSON）：长文本自己走代码块，短值一行一个。 */
function ToolArgs({ args }: { args: unknown }) {
  const entries = Object.entries((args ?? {}) as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <dl className="tool-args">
      {entries.map(([key, value]) => (
        <div key={key} className="tool-arg">
          <dt>{key}</dt>
          <dd>{typeof value === "string" && value.includes("\n") ? <pre>{value}</pre> : brief(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 短值的一行写法：字符串原样（含引号会看不出来是字符串）、其余 JSON 化。 */
function brief(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function firstLine(text: string): string {
  return truncate(text.trim().split("\n")[0] ?? "", 60);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
