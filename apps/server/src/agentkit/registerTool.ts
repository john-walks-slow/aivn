import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { assetRegister, assetRegisterFields, tighten, type AssetRegisterArgs, type AssetRegistration } from "@aivn/agent";
import type { AssetKind } from "@aivn/core";
import type { AssetLibrary } from "../library.js";
import { importFromLibrary } from "../assetImport.js";
import type { PlayAssets } from "../playAssets.js";
import type { PlayStore } from "../store.js";
import type { PlayFileWrite } from "../workshop.js";
import { toPi } from "./schema.js";
import { linesResult, reason, textResult } from "./result.js";

/**
 * `import_asset`：把一张**外来的图**登记成剧目素材（只给工坊）。
 *
 * 服务端过去没有这个口：工坊靠 `generate_image` 直落、剧作家靠「引用即导入」。缺了它，
 * 「别的工具产出的图 / 用户自己下的图 / 别人的候选想换一张」就没有入库的路——而这正是
 * 插件那边的原子三件套之一（出候选 →（立绘）抠底 → 登记）。
 *
 * 参数真相源、描述正文与落位归一化都在 `@aivn/agent` 的 `asset.register`；这里只声明服务端的
 * face（pi 的长度收紧）与回执。
 */
const FACE = tighten(
  {
    ...assetRegisterFields,
    kind: {
      type: "string",
      enum: ["background", "cg", "sprite", "bgm", "ambient", "sfx"],
      required: true,
      description: "要落成什么剧目素材：背景 background / 事件插图 cg / 立绘 sprite / 音乐 bgm / 环境音 ambient / 音效 sfx（后三者从资源库导入用）。",
    },
  },
  {
    source: { minLength: 1, maxLength: 2000 },
    name: { maxLength: 40 },
    spriteId: { maxLength: 40 },
    variant: { maxLength: 40 },
    title: { maxLength: 40 },
    description: { maxLength: 300 },
    prompt: { maxLength: 4000 },
    original: { maxLength: 2000 },
  },
);

const importParams = toPi(FACE);

export interface ImportAssetDeps {
  playAssets?: PlayAssets;
  /** 剧目 id 与存储面：`library:` 来源那条路要拿它们拼 URL、落盘。 */
  playId: string;
  store: PlayStore;
  /** 应用级素材资源库；没配就不认 `library:` 这种来源（其余来源照常）。 */
  library?: AssetLibrary;
  onAsset: (
    path: string,
    url: string,
    kind: "background" | "cg" | "sprite",
    replaced: boolean,
    toolCallId: string,
  ) => void;
  onWrite?: (write: PlayFileWrite) => void;
}

/**
 * 资源库来源的写法：`library://<entryId>`（条目 id 见 `list_library`，类别由外层 `kind` 指定）。
 *
 * 这一条把「从库导入」并进了登记这一个动词：入库只有一个工具，来源是它的一格参数。
 */
const LIBRARY_SOURCE = /^library:\/\/(.*)$/;

/** 落位各认哪些库类别：`sprite` 收 characters 与 sprites（角色包与纯立绘都是立绘类目）。 */
const LIBRARY_KINDS: Record<string, readonly AssetKind[]> = {
  background: ["backgrounds"],
  cg: ["cg"],
  sprite: ["characters", "sprites"],
  bgm: ["bgm"],
  ambient: ["ambient"],
  sfx: ["sfx"],
};

const ALL_LIBRARY_KINDS: readonly AssetKind[] = ["backgrounds", "cg", "sprites", "characters", "bgm", "ambient", "sfx"];

/** 库类别 → 素材气泡的类别（图片气泡：背景 / 插图 / 立绘；音频不推图片气泡）。 */
function bubbleKindOf(kind: AssetKind): "background" | "cg" | "sprite" | null {
  if (kind === "backgrounds") return "background";
  if (kind === "cg") return "cg";
  if (kind === "sprites" || kind === "characters") return "sprite";
  return null;
}

export function createImportAssetTool(deps: ImportAssetDeps): AgentTool<typeof importParams> {
  return {
    name: "import_asset",
    label: "登记素材",
    description:
      `${assetRegister.doc}\n` +
      "`source` 另认**资源库里的条目** `library://<entryId>`（条目 id 见 `list_library`，类别由 `kind` 指定）：" +
      "条目自带的描述、差分与角色卡一并搬进来；名字按 `name` / `spriteId` 落（缺省用条目 id）。素材未配后端时这条也同样能用。",
    parameters: importParams,
    execute: async (toolCallId, params: Static<typeof importParams>) => {
      // pi 那边参数是 unknown（能力只给字段真相源），这一层按服务端参数类型收窄一次。
      const args = params as Omit<AssetRegisterArgs, "kind"> & {
        kind: "background" | "cg" | "sprite" | "bgm" | "ambient" | "sfx";
      };
      // 库来源不走登记那条路：一个条目可能落好几份文件（立绘包 = 若干差分 + 角色卡），
      // 回执要逐份列全，登记那份单文件的契约装不下。
      const hit = LIBRARY_SOURCE.exec(args.source.trim());
      if (hit) {
        if (!deps.library) return textResult("本实例没配资源库：`library://` 这种来源不认（路径 / 网址照常）。");
        const entryId = (hit[1] ?? "").trim();
        if (entryId === "" || entryId.includes("/")) {
          return textResult("`library://` 后面直接跟条目 id（不带分类目录，分类由 `kind` 参数指定）：`library://<entryId>`。");
        }

        const candidates = LIBRARY_KINDS[args.kind] ?? [];
        let libKind: AssetKind | undefined;
        for (const candidate of candidates) {
          if (await deps.library.entry(candidate, entryId)) {
            libKind = candidate;
            break;
          }
        }
        if (!libKind) {
          for (const other of ALL_LIBRARY_KINDS) {
            if (!candidates.includes(other) && (await deps.library.entry(other, entryId))) {
              return textResult(
                `source 指向的 \`${entryId}\` 在库里属于 ${other}，落位给的 kind 是 ${args.kind}——两者对不上。` +
                  `背景用 kind=background、插图 kind=cg、立绘（含角色包）kind=sprite、音乐/环境音/音效用 kind=bgm/ambient/sfx。`,
              );
            }
          }
          libKind = candidates[0]!;
        }

        const landing = args.kind === "sprite" ? args.spriteId : args.name;
        try {
          const result = await importFromLibrary(deps.library, deps.store, {
            kind: libKind,
            entryId,
            ...(landing ? { as: landing } : {}),
            ...(args.title || args.description
              ? { meta: { ...(args.title ? { title: args.title } : {}), ...(args.description ? { description: args.description } : {}) } }
              : {}),
          });
          const bubble = bubbleKindOf(result.kind);
          if (bubble) {
            for (const path of result.files) {
              deps.onAsset(path, `/plays/${deps.playId}/${path}`, bubble, false, toolCallId);
            }
          }
          for (const write of result.writes) deps.onWrite?.(write);
          const lines = [`已从资源库导入 ${libKind}/${entryId}：`];
          for (const path of result.files) lines.push(`- \`${path}\``);
          if (result.characters.length > 0) lines.push(`- 角色卡：${result.characters.map((id) => `\`characters/${id}.md\``).join("、")}`);
          if (result.files.length === 0) lines.push("- （条目里没有文件：只落了声明，图 / 曲子以后补）");
          return linesResult(lines);
        } catch (error) {
          return textResult(`导入失败：${reason(error)}`);
        }
      }
      if (args.kind === "bgm" || args.kind === "ambient" || args.kind === "sfx") {
        return textResult(
          `音频（${args.kind}）在 import_asset 里只收资源库来源（source="library://<条目id>"）；生成新 BGM 请调 generate_bgm。`,
        );
      }
      if (!deps.playAssets) return textResult("素材未启用（STAGE_ASSETS_ENABLED=false）。");
      // 预览 URL 与归一化体检都是服务端的回执知识（能力只给落位），顺手带出来。
      let url = "";
      let cutout: { figureTop: number; figureHeight: number } | undefined;
      try {
        const registered = await assetRegister.execute(params as AssetRegisterArgs, {
          register: async (source, location, extra): Promise<AssetRegistration> => {
            const asset = await deps.playAssets!.register(source, location, extra);
            url = asset.url;
            cutout = asset.cutout;
            return {
              kind: asset.kind,
              path: asset.path,
              replaced: asset.replaced,
              ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
            };
          },
        });
        deps.onAsset(registered.path, url, registered.kind, registered.replaced, toolCallId);
        const label = registered.kind === "sprite" ? "立绘" : registered.kind === "background" ? "背景" : "插图";
        return linesResult([
          `${label}已登记：\`${registered.path}\`${registered.replaced ? "（覆盖了同名旧素材）" : ""}`,
          `![${registered.kind}](${url})`,
          cutout ? `立绘已按该差分的取景归一化：人物高 ${cutout.figureHeight}px、头顶留白 ${cutout.figureTop}px（舞台据此摆位）。` : "",
          registered.sourcePath ? `抠底前原片已留底：\`${registered.sourcePath}\`。` : "",
        ]);
      } catch (error) {
        return textResult(`登记失败：${reason(error)}`);
      }
    },
  };
}
