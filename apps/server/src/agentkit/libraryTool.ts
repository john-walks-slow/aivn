import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describeAsset, libraryEntryMatches, type AssetKind, type WorkshopAssetView } from "@aivn/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { AssetLibrary } from "../library.js";
import { importFromLibrary } from "../assetImport.js";
import type { PlayStore } from "../store.js";
import type { ImportResult } from "../assetImport.js";
import type { PlayFileWrite } from "./deps.js";
import { reason, textResult } from "./result.js";

/**
 * 素材资源库的两个工具：`list_library`（只读浏览）与 `import_asset`（复制进剧目）。
 *
 * 两个角色的依赖是**同一份**：`onWrite` 是写盘后的刷新信号（各页重拉），`onAsset` 往工坊对话流
 * 推素材气泡。剧作家那条线上没有对话流可挂，宿主给空实现——工具照常能用，只是没有气泡可看。
 *
 * 剧作家的**默认**用法不是这两个工具：它在剧本里写个 id，宿主发现剧目里没有就去库里导入
 * （见 `assetRef.ts`），所以剧作家侧只装 `list_library`（`importAsset: false`）。
 */

/** 资源库罗列的截断：一次把整个库灌进上下文没有意义，够 agent 判断「有没有」就行。 */
const LIST_LIMIT = 40;

/**
 * 资源库类别：characters 是角色包（角色卡 + 可选立绘）、sprites 是纯立绘
 * （机甲、道具、猫这类不是人的主体），其余是单文件条目。
 */
const libraryKind = Type.Union([
  Type.Literal("backgrounds"),
  Type.Literal("cg"),
  Type.Literal("sprites"),
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
    /**
     * 条目 id（也就是导入后的文件名主体，剧本里的 bg/cg id 就是它），
     * 或**同一类别的一批 id**——批量的意义在于一次往返导完，逐个调用每条都要重跑一轮模型。
     */
    entryId: Type.Union([
      Type.String({ maxLength: 64 }),
      Type.Array(Type.String({ maxLength: 64 }), { minItems: 1, maxItems: LIST_LIMIT }),
    ]),
    /** 立绘类目（characters / sprites）只导这几条差分（缺省全导）。 */
    variants: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { maxItems: 24 })),
    /** 落点为固定 id 的主角卡（characters/protagonist.md），而不是以条目 id 命名的新卡。 */
    target: Type.Optional(Type.Literal("protagonist")),
  },
  { additionalProperties: false },
);

export interface LibraryToolDeps {
  playId: string;
  store: PlayStore;
  /** 库没配就不注册这两个工具（装一个必然查不出东西的工具只会诱使模型空转）。 */
  library?: AssetLibrary;
  /** 写盘回调：推给工坊对话流（剧作家侧给空实现即可）。 */
  onWrite?: (write: PlayFileWrite) => void;
  /** 素材落盘回调：推给工坊对话流，挂到产出它的那次调用上。 */
  onAsset?: (asset: WorkshopAssetView, replaced?: boolean, toolCallId?: string) => void;
  /**
   * 装不装 `import_asset`（缺省装）。
   *
   * 剧作家侧不装：它的默认导入路径是**引用即导入**（剧本里写个 id，宿主去库里搬），
   * 自己动手搬一遍是同一件事的第二条路。`TOOL_CATALOG` 里这一项也标了 workshop。
   */
  importAsset?: boolean;
}

export function createLibraryTools(deps?: LibraryToolDeps): AgentTool<any>[] {
  const library = deps?.library;
  if (!deps || !library) return [];

  const listLibrary: AgentTool<typeof listLibraryParams> = {
    name: "list_library",
    label: "浏览素材资源库",
    description:
      "浏览应用级素材资源库（跨剧目复用的本地素材目录，由用户在本地维护，你只读不写）。\n" +
      "**要素材先查库**。用户说「弄张教室的图」「配首忧伤的音乐」「来个门响的音效」「找个角色」「有台机甲的立绘吗」，先用本工具" +
      "（可以带 kind 或 query 关键词）看有没有现成的，有就 import_asset 导入（挑中的同类条目一次传数组导完）。库里有就**不要**再 generate_image。\n" +
      "可给 kind 过滤类别（backgrounds/cg/sprites/characters/bgm/sfx），可给 query 按关键词搜描述与标签。\n" +
      "每行是：id | 类别 | 标题 | 描述（立绘类目还会列出可用差分名，角色包还标了是否主角）。\n" +
      "**kind=characters 是角色包**（角色卡 + 可选立绘）、**kind=sprites 是纯立绘**（机甲、道具、猫——台上任何不是人的主体）：" +
      "两者都会把立绘复制进 `assets/sprites/<id>/`，条目带 `meta.character` 时还会写一张角色卡；只声明了图的条目**不建空壳卡**。" +
      "条目 id 就是立绘目录名，导入后 `<actor id=\"…\" variant=\"…\">` 直接可用。\n" +
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
        const variants =
          e.kind === "characters" || e.kind === "sprites"
            ? ` | 差分：${Object.keys(e.meta.variants ?? {}).join(", ") || e.files.map((f) => f.name).join(", ")}`
            : "";
        const role = e.meta.character?.protagonist ? " | 主角" : "";
        const warning = e.warnings?.length ? ` | ⚠ ${e.warnings.join("；")}` : "";
        return `${e.id} | ${e.kind} | ${e.title} | ${detail}${variants}${role}${warning}`;
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
      "把资源库里的条目复制进本剧目（写进 assets/ 与角色表）。" +
      "kind 是类别（backgrounds/cg/sprites/characters/bgm/sfx）；entryId 是一个条目 id，" +
      "也可以是**同一类别的一批 id（数组）**——按单子导素材时就该一次传完，不要一个一个导；" +
      "不同类别分几次调用。" +
      "characters / sprites 条目把立绘复制进 `assets/sprites/<id>/`：条目带 meta.character 时同时写一张角色卡" +
      "（带 target=protagonist 则写主角卡，只配单个条目），只声明了图的条目只落图、不建卡。" +
      "导完这些 id 就能在剧本里直接引用（立绘写 `<actor id=\"…\" variant=\"…\">`）。" +
      "重复导入同一 id 会**覆盖**剧目里的同名素材。",
    parameters: importAssetParams,
    execute: async (toolCallId, params: Static<typeof importAssetParams>) => {
      const entryIds = Array.isArray(params.entryId) ? params.entryId : [params.entryId];
      // 主角卡只有一张、差分清单是逐条目的：这两项配批量就是在猜给谁用，直接说清而不是挑一条应用
      if (entryIds.length > 1 && params.target) {
        return textResult("target=protagonist 只配单个条目：主角卡只有一张，一次导多个会互相覆盖。分开调用。");
      }
      if (entryIds.length > 1 && params.variants) {
        return textResult("variants 是逐条目的差分清单，批量导入时不知道补给谁。分开调用。");
      }
      const results: ImportResult[] = [];
      const failed: string[] = [];
      for (const entryId of entryIds) {
        try {
          const result = await importFromLibrary(library, deps.store, {
            kind: params.kind as AssetKind,
            entryId,
            variants: params.variants,
            target: params.target,
          });
          results.push(result);
          // 素材表与角色卡的改动要推刷新信号——各页靠它重拉
          for (const path of result.files) {
            deps.onAsset?.(
              { kind: viewKind(params.kind), path, url: `/plays/${deps.playId}/${path}` },
              undefined,
              toolCallId,
            );
          }
          for (const write of result.writes) deps.onWrite?.(write);
        } catch (error) {
          // 一条导不动不影响其余的：回执照实列出哪条没进来，模型才知道该改哪个 id
          failed.push(`${entryId}（${reason(error)}）`);
        }
      }
      if (results.length === 0) return textResult(`导入失败：${failed.join("；")}`);
      return textResult(renderImportResult(params.kind, results, failed));
    },
  };

  return deps.importAsset === false ? [listLibrary] : [listLibrary, importAsset];
}

/** 资源库类别 → 素材气泡的类别（目录名是复数，气泡里按「背景/音效」这种人话分类）。 */
function viewKind(kind: string): WorkshopAssetView["kind"] {
  switch (kind) {
    case "backgrounds":
      return "background";
    case "cg":
      return "cg";
    case "characters":
    case "sprites":
      return "sprite";
    default:
      return kind === "sfx" ? "sfx" : "bgm";
  }
}

/** 导入回执：落盘位置 + 剧本引用写法，agent 直接照着转述给用户。 */
function renderImportResult(kind: string, results: ImportResult[], failed: string[]): string {
  const isSpriteKind = kind === "characters" || kind === "sprites";
  const body = isSpriteKind ? renderSpriteImports(results) : renderMediaImports(kind, results);
  return failed.length > 0 ? `${body}\n这 ${failed.length} 条没导进来：${failed.join("；")}` : body;
}

/** 单文件类别（背景 / CG / BGM / 音效）：引用写法与素材表说明整批说一次，别每条复述一遍。 */
function renderMediaImports(kind: string, results: ImportResult[]): string {
  const usage: Record<string, (id: string) => string> = {
    backgrounds: (id) => `<scene bg="${id}" />`,
    cg: (id) => `<cg id="${id}" />`,
    bgm: (id) => `<scene bgm="${id}" />`,
    sfx: (id) => `<sfx src="${id}" />`,
  };
  const entries = results.map((r) => {
    const tag = usage[kind]?.(r.id);
    return `${r.id} → ${r.files[0]}${tag ? `（剧本引用：${tag}）` : ""}`;
  });
  const list =
    entries.length > 1 ? `已导入 ${entries.length} 条：\n${entries.map((e) => `- ${e}`).join("\n")}` : `已导入 ${entries[0]}`;
  return `${list}\n素材描述已写进 assets/manifest.json，剧作家在剧本里能按描述选它。`;
}

/**
 * 立绘类目：图与卡是两件独立的事（可能只有卡、可能只有图），每个条目分别说清落了什么、台上怎么引用。
 *
 * 只声明了图的条目**不建空壳卡**，所以没有卡这件事要说明白——机甲、道具这类不是人的主体本来就该只有图。
 */
function renderSpriteImports(results: ImportResult[]): string {
  return results
    .map((result) => {
      const dir = result.files[0]?.replace(/\/[^/]+$/, "");
      const spriteLine = result.files.length ? `立绘 ${result.files.length} 张 → ${dir}/` : "这个条目没有立绘";
      const cardLine = result.characters.length
        ? `角色卡 → characters/${result.characters.join("、")}.md`
        : "这个条目没有角色原料（`meta.character`），只落了图——机甲、道具这类不是人的主体本来就该只有图";
      const usage = `剧本里这样引用：<actor id="${result.spriteId}" variant="neutral" />`;
      if (result.protagonist) {
        return [
          `已导入主角 → ${cardLine}，${spriteLine}。`,
          usage,
          "主角与别的角色同权：要不要上台、用不用立绘与配音，照剧目创作口径（memory/always/craft.md）来。",
        ].join("\n");
      }
      return [`已导入 ${result.spriteId}：${cardLine}，${spriteLine}。`, usage].join("\n");
    })
    .join("\n\n");
}
