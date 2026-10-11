import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describeAsset, libraryEntryMatches, type AssetKind } from "@aivn/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { AssetLibrary } from "../library.js";
import { textResult } from "./result.js";

/**
 * 素材资源库的**浏览**工具：`list_library`（只读）。
 *
 * 从库往剧目里搬东西不在这里——那是 `import_asset` 的一格来源（`library:<kind>/<entryId>`）：
 * 入库只有一个动词，「从哪来」由 source 说。剧作家的默认路子仍是**引用即导入**
 * （剧本里写个 id，宿主发现剧目里没有就去库里搬，见 `assetRef.ts`）。
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
  Type.Literal("ambient"),
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

export interface LibraryToolDeps {
  /** 库没配就不注册这个工具（装一个必然查不出东西的工具只会诱使模型空转）。 */
  library?: AssetLibrary;
}

export function createLibraryTools(deps?: LibraryToolDeps): AgentTool<any>[] {
  const library = deps?.library;
  if (!library) return [];

  const listLibrary: AgentTool<typeof listLibraryParams> = {
    name: "list_library",
    label: "浏览素材资源库",
    description:
      "浏览应用级素材资源库（跨剧目复用的本地素材目录，由用户在本地维护，你只读不写）。\n" +
      "**要素材先查库**。用户说「弄张教室的图」「配首忧伤的音乐」「来个门响的音效」「找个角色」「有台机甲的立绘吗」，先用本工具" +
      "（可以带 kind 或 query 关键词）看有没有现成的，有就用 `import_asset(source=\"library:<kind>/<entryId>\")` 导入" +
      "（同类条目分几次调用，都可以放在同一条消息里）。库里有就**不要**再 generate_image。\n" +
      "可给 kind 过滤类别（backgrounds/cg/sprites/characters/bgm/sfx），可给 query 按关键词搜描述与标签。\n" +
      "每行是：id | 类别 | 标题 | 描述（立绘类目还会列出可用差分名，角色包还标了是否主角）。\n" +
      "**kind=characters 是角色包**（角色卡 + 可选立绘）、**kind=sprites 是纯立绘**（机甲、道具、猫——台上任何不是人的主体）：" +
      "两者都会把立绘复制进 `assets/sprites/<id>/`，条目带 `meta.character` 时还会写一张角色卡；只声明了图的条目**不建空壳卡**。" +
      "条目 id 就是立绘目录名，导入后 `<actor id=\"…\" variant=\"…\">` 直接可用。\n" +
      "**库和剧目各存一份**：导入是把文件复制进本剧目的 assets/，删库不影响剧目；但资源库里的" +
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

  return [listLibrary];
}
