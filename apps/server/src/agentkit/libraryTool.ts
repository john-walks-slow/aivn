import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describeAsset, isAssetKind, libraryEntryMatches, type WorkshopAssetView } from "@stage-ai/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { importFromLibrary, type ImportResult } from "../assetImport.js";
import type { WorkshopKitDeps } from "./deps.js";
import { reason, textResult } from "./result.js";

/**
 * 素材资源库工具组（仅工坊）：list_library / import_asset。
 *
 * 先有资源再出图——库里有的背景/立绘/BGM 优先导入，别重复花钱出一张。
 * 剧作家不装这两个：导入会改 play.json 与 assets/，在拍进行中动它等于腰斩演出。
 */

/** 资源库类别：characters 是角色包（角色卡 + 可选立绘），其余是单文件条目。 */
const libraryKind = Type.Union([
  Type.Literal("backgrounds"),
  Type.Literal("cg"),
  Type.Literal("characters"),
  Type.Literal("bgm"),
  Type.Literal("sfx"),
]);
const listLibraryParams = Type.Object(
  {
    kind: Type.Optional(libraryKind),
    /** 关键词：匹配 id / 标题 / 描述 / 标签 / 情绪 / 适用场景。 */
    query: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
);
const importAssetParams = Type.Object(
  {
    kind: libraryKind,
    /** 资源库条目 id（list_library 给的那一列），导入后它就是剧本里的引用名。 */
    entryId: Type.String({ maxLength: 64 }),
    /** 角色包只导这几条差分（缺省全导）。 */
    expressions: Type.Optional(Type.Array(Type.String({ maxLength: 32 }), { maxItems: 40 })),
    /** 给 "protagonist" 时写进 play.json 的主角卡而不是角色列表。 */
    target: Type.Optional(Type.Literal("protagonist")),
  },
  { additionalProperties: false },
);

/** 资源库罗列的截断：一次把整个库灌进上下文没有意义，够 agent 判断「有没有」就行。 */
const LIST_LIMIT = 40;

export function createLibraryTools(
  deps: Pick<WorkshopKitDeps, "playId" | "store" | "assetLibrary" | "onWrite" | "onAsset">,
): AgentTool<any>[] {
  const library = deps.assetLibrary;
  if (!library) return [];

  const listLibrary: AgentTool<typeof listLibraryParams> = {
    name: "list_library",
    label: "浏览素材资源库",
    description:
      "浏览应用级素材资源库（跨剧目复用的本地素材目录，用户在本地维护）。" +
      "可给 kind 过滤类别（backgrounds/cg/characters/bgm/sfx），可给 query 按关键词搜描述与标签。" +
      "每行是：id | 类别 | 标题 | 描述（角色包还会列出可用差分名与是否标了主角）。" +
      "找现成素材一律先来这里，库里有的就别再 generate_image 出一张。",
    parameters: listLibraryParams,
    execute: async (_id, params: Static<typeof listLibraryParams>) => {
      const all = await library.list();
      const query = params.query ?? "";
      const matched = all.filter(
        (e) => (!params.kind || e.kind === params.kind) && libraryEntryMatches(e, query),
      );
      if (matched.length === 0) {
        return textResult(
          all.length === 0
            ? "资源库是空的（没有可用素材）。需要什么素材，出图或让用户在素材页上传。"
            : `没有匹配「${query}」${params.kind ? `且类别为 ${params.kind} ` : ""}的素材（共 ${all.length} 条，换个词或去掉过滤再试）。`,
        );
      }
      const shown = matched.slice(0, LIST_LIMIT);
      const lines = shown.map((e) => {
        const detail = describeAsset(e.meta);
        const expressions =
          e.kind === "characters"
            ? ` | 差分：${Object.keys(e.meta.expressions ?? {}).join(", ") || e.files.map((f) => f.name).join(", ")}`
            : "";
        const role = e.meta.character?.protagonist ? " | 主角" : "";
        const warning = e.warnings?.length ? ` | ⚠ ${e.warnings.join("；")}` : "";
        return `${e.id} | ${e.kind} | ${e.title} | ${detail}${expressions}${role}${warning}`;
      });
      if (matched.length > shown.length) {
        lines.push(`（共 ${matched.length} 条，这里只列了前 ${shown.length} 条；用 query 缩小范围）`);
      }
      return textResult(lines.join("\n"));
    },
  };

  const importAsset: AgentTool<typeof importAssetParams> = {
    name: "import_asset",
    label: "从资源库导入素材",
    description:
      "把资源库里的一个素材复制进本剧目（kind + entryId 来自 list_library），并把元数据写进剧目的素材描述表，" +
      "让剧作家看得懂它是什么、能按情绪选曲。kind=characters 时把角色卡写进 play.json（配 target=protagonist " +
      "则写主角卡），有条目里的立绘就一并复制并登记差分映射。回执里带引用写法，可以直接转述给用户。",
    parameters: importAssetParams,
    execute: async (_id, params: Static<typeof importAssetParams>) => {
      if (!isAssetKind(params.kind)) return textResult(`未知素材类别: ${params.kind}`);
      try {
        const result = await importFromLibrary(library, deps.store, {
          kind: params.kind,
          entryId: params.entryId,
          ...(params.expressions && params.expressions.length > 0
            ? { expressions: params.expressions }
            : {}),
          ...(params.target ? { target: params.target } : {}),
        });
        for (const path of result.files) {
          deps.onAsset({
            kind: viewKind(params.kind),
            path,
            url: `/plays/${deps.playId}/assets/${path.replace(/^assets\//, "")}`,
          });
        }
        // 素材表与角色卡的改动要进撤销条——导入改了剧目配置，用户得能反悔
        for (const write of result.writes) deps.onWrite(write);
        return textResult(renderImportResult(params.kind, result));
      } catch (error) {
        return textResult(`导入失败：${reason(error)}`);
      }
    },
  };

  return [listLibrary, importAsset];
}

/** 资源库类别 → 素材气泡的类别（目录名是复数，气泡里按「背景/音效」这种人话分类）。 */
function viewKind(kind: string): WorkshopAssetView["kind"] {
  switch (kind) {
    case "backgrounds":
      return "background";
    case "cg":
      return "cg";
    case "characters":
      return "sprite";
    default:
      return kind === "sfx" ? "sfx" : "bgm";
  }
}

/** 导入回执：落盘位置 + 剧本引用写法，agent 直接照着转述给用户。 */
function renderImportResult(kind: string, result: ImportResult): string {
  if (kind !== "characters") {
    const usage: Record<string, string> = {
      backgrounds: `<scene bg="${result.id}" />`,
      cg: `<cg id="${result.id}" />`,
      bgm: `<scene bgm="${result.id}" />`,
      sfx: `<sfx src="${result.id}" />`,
    };
    return [
      `已导入 ${result.id} → ${result.files[0]}`,
      "素材描述已写进 assets/manifest.json，剧作家在剧本里能按描述选它。",
      `剧本里这样引用：${usage[kind] ?? result.id}`,
    ].join("\n");
  }
  // 角色包里卡与图是两件独立的事（可能只有卡没有图），回执要分别说清落了什么
  if (result.protagonist) {
    return [`已导入角色卡 ${result.id} → play.json 的主角卡`, "主角没有立绘位（舞台只画角色），所以这次没有复制图片。"].join("\n");
  }
  const sprites = result.files.length
    ? `，立绘 ${result.files.length} 张落在 ${result.files[0]!.replace(/\/[^/]+$/, "")}/`
    : "（这个条目没有立绘，只导了角色卡）";
  const card = `play.json 已写入角色卡 ${result.characters.join("、")}${result.files.length ? " 与差分映射，剧作家可以直接 <actor id=\"…\" expression=\"…\"> 上台" : ""}`;
  return [`已导入角色 ${result.id}${sprites}`, card].join("\n");
}
