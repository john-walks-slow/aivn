import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describeAsset, libraryEntryMatches, type AssetKind, type WorkshopAssetView } from "@aivn/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { AssetLibrary } from "../library.js";
import { importFromLibrary } from "../assetImport.js";
import type { PlayStore } from "../store.js";
import type { ImportResult } from "../assetImport.js";
import type { PlayFileWrite } from "./deps.js";
import { textResult } from "./result.js";

/**
 * 素材资源库的两个工具：`list_library`（只读浏览）与 `import_asset`（复制进剧目）。
 *
 * 两个角色的依赖是**同一份**：`onWrite` / `onAsset` 往工坊对话流推撤销条与素材气泡，
 * 剧作家那条线上没有对话流可挂，宿主给空实现——工具照常能用，只是没有撤销条可点。
 *
 * 剧作家的**默认**用法不是这两个工具：它在剧本里写个 id，宿主发现剧目里没有就去库里导入
 * （见 `assetRef.ts`）。`import_asset` 在剧作家这边默认关闭；用户想让它自己动手再勾上。
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
    /** 条目 id，也就是导入后的文件名主体（剧本里的 bg/cg id 就是它）。 */
    entryId: Type.String({ maxLength: 64 }),
    /** characters 条目只导这几条差分（缺省全导）。 */
    expressions: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 24 })),
    /** 落点为固定 id 的主角卡（characters/protagonist.md），而不是以条目 id 命名的新卡。 */
    target: Type.Optional(Type.Literal("protagonist")),
  },
  { additionalProperties: false },
);

/** 资源库罗列的截断：一次把整个库灌进上下文没有意义，够 agent 判断「有没有」就行。 */
const LIST_LIMIT = 40;

export interface LibraryToolDeps {
  playId: string;
  store: PlayStore;
  /** 库没配就不注册这两个工具（装一个必然查不出东西的工具只会诱使模型空转）。 */
  library?: AssetLibrary;
  /** 写盘回调：推给工坊对话流（剧作家侧给空实现即可）。 */
  onWrite?: (write: PlayFileWrite) => void;
  /** 素材落盘回调：推给工坊对话流内联展示。 */
  onAsset?: (asset: WorkshopAssetView, replaced?: boolean) => void;
}

export function createLibraryTools(deps?: LibraryToolDeps): AgentTool<any>[] {
  const library = deps?.library;
  if (!deps || !library) return [];

  const listLibrary: AgentTool<typeof listLibraryParams> = {
    name: "list_library",
    label: "浏览素材资源库",
    description:
      "浏览应用级素材资源库（跨剧目复用的本地素材目录，由用户在本地维护，你只读不写）。\n" +
      "**要素材先查库**。用户说「弄张教室的图」「配首忧伤的音乐」「来个门响的音效」「找个角色」，先用本工具" +
      "（可以带 kind 或 query 关键词）看有没有现成的，有就 import_asset 导入。库里有就**不要**再 generate_image。\n" +
      "可给 kind 过滤类别（backgrounds/cg/characters/bgm/sfx），可给 query 按关键词搜描述与标签。\n" +
      "每行是：id | 类别 | 标题 | 描述（角色包还会列出可用差分名与是否标了主角）。\n" +
      "**kind=characters 是角色包**：条目里的角色卡会写进 play.json（配 target=protagonist 则写主角卡），" +
      "条目里带立绘就一并复制并登记差分映射。库里有设定、但立绘还空着的角色很正常——先导卡、图后面再画。\n" +
      "库里的角色 id 就是立绘目录名，导入后 `<actor id=\"…\">` 直接可用。\n" +
      "**库和剧目各存一份**：import_asset 是把文件复制进本剧目的 assets/，删库不影响剧目；但资源库里的" +
      "素材不会自动出现在别的剧目里，要用就得各导一次。\n" +
      "导入素材的元数据（描述、标签、音乐的情绪/适用场景/时长/是否可循环）会一并写进剧目素材表，" +
      "剧作家据此选曲选图——所以库里的描述写得准不准，直接影响演出效果。\n" +
      "**BGM 与音效资源库里没有就别硬凑**：告诉用户「库里没有音乐，需要你放几首进 library/bgm/」，" +
      "别拿不相关的曲子顶上。",
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
    label: "从资源库导入",
    description:
      "把资源库里的一个条目复制进本剧目（写进 assets/ 与角色表）。" +
      "kind 是类别（backgrounds/cg/characters/bgm/sfx），entryId 是条目 id。" +
      "characters 条目会把角色卡写进 play.json，带 target=protagonist 则写主角卡；" +
      "条目里的立绘会一并复制并登记差分映射。导完这个 id 就能在剧本里直接引用。" +
      "重复导入同一 id 会**覆盖**剧目里的同名素材。",
    parameters: importAssetParams,
    execute: async (_id, params: Static<typeof importAssetParams>) => {
      try {
        const result = await importFromLibrary(library, deps.store, {
          kind: params.kind as AssetKind,
          entryId: params.entryId,
          expressions: params.expressions,
          target: params.target,
        });
        for (const path of result.files) {
          deps.onAsset?.({ kind: viewKind(params.kind), path, url: `/plays/${deps.playId}/${path}` });
        }
        // 素材表与角色卡的改动要进撤销条——导入改了剧目配置，用户得能反悔
        for (const write of result.writes) deps.onWrite?.(write);
        return textResult(renderImportResult(params.kind, result));
      } catch (error) {
        return textResult(`导入失败：${error instanceof Error ? error.message : String(error)}`);
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
    const sprites = result.files.length
      ? `，立绘 ${result.files.length} 张落在 ${result.files[0]!.replace(/\/[^/]+$/, "")}/`
      : "（这个条目没有立绘，只导了卡）";
    return `已导入主角卡 → characters/protagonist.md${sprites}。主角与别的角色同权：要不要上台、用不用立绘与配音，照剧目创作口径（memory/always/craft.md）来。`;
  }
  const sprites = result.files.length
    ? `，立绘 ${result.files.length} 张落在 ${result.files[0]!.replace(/\/[^/]+$/, "")}/`
    : "（这个条目没有立绘，只导了角色卡）";
  const card =
    `角色卡已写入 characters/${result.characters.join("、")}.md` +
    (result.files.length ? " 与差分映射，剧作家可以直接 <actor id=\"…\" expression=\"…\"> 上台" : "");
  return [`已导入角色 ${result.id}${sprites}`, card].join("\n");
}
