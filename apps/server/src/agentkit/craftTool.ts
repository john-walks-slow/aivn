import { type Static, Type } from "@earendil-works/pi-ai";
import { parsePlayConfig } from "@aivn/core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CRAFT_ENUMS, describeCraftParams, mergeCraftParams, resolveCraft, type CraftPatch } from "../craftParams.js";
import { withPlayConfigLock } from "../store.js";
import type { WorkshopKitDeps } from "./deps.js";
import { textResult } from "./result.js";

/**
 * 写作参数工具（仅工坊）：改 `play.json` 的 `craft` 段——每轮篇幅、停止点选项数、素材来源。
 *
 * 为什么不走 write/edit：那是三个字段的结构化配置，而 `play.json` 里还躺着 `id`/`title`/
 * `initialState` 这些引擎状态，让模型整篇重写一遍等于把整份配置交给一次自由发挥。
 * 更实际的是**撤销与并发**：这里的读改写包在 `withPlayConfigLock` 里，与引用即导入、
 * 工坊文件页共用一条队列——模型手写 edit 撞上另一个写者，后写的会静默吃掉先写的。
 *
 * 参数三态（省略 / 给值 / null）见 `craftParams.ts` 的 `CraftPatch`：省略 = 不动，
 * null = 恢复默认（该字段从 play.json 里消失，日后引擎默认值改了它跟着改）。
 */
const reset = { description: "给 null = 恢复引擎默认值（该字段从 play.json 移除）" };

const setCraftParams = Type.Object(
  {
    beatLength: Type.Optional(
      Type.Union(
        [
          Type.Literal(CRAFT_ENUMS.beatLength[0]),
          Type.Literal(CRAFT_ENUMS.beatLength[1]),
          Type.Literal(CRAFT_ENUMS.beatLength[2]),
          Type.Null(),
        ],
        { description: "一轮写多长：short 一个来回就收 / medium 演完一小段 / long 演完一整场戏" },
      ),
    ),
    stopOptions: Type.Optional(
      Type.Union(
        [
          Type.Literal(CRAFT_ENUMS.stopOptions[0]),
          Type.Literal(CRAFT_ENUMS.stopOptions[1]),
          Type.Literal(CRAFT_ENUMS.stopOptions[2]),
          Type.Literal(CRAFT_ENUMS.stopOptions[3]),
          Type.Null(),
        ],
        { description: "停止点给几条选项：two/three/four = 每次 2/3/4 条，free = 固定停在自由输入框" },
      ),
    ),
    assets: Type.Optional(
      Type.Union(
        [
          Type.Object(
            {
              background: Type.Optional(
                Type.Union(
                  [
                    Type.Literal(CRAFT_ENUMS.background[0]),
                    Type.Literal(CRAFT_ENUMS.background[1]),
                    Type.Literal(CRAFT_ENUMS.background[2]),
                    Type.Null(),
                  ],
                  { description: "library-first 素材资源库优先、没有合适的再出图 / library 只用库里现成的 / generate 直接出图" },
                ),
              ),
              cg: Type.Optional(
                Type.Union(
                  [
                    Type.Literal(CRAFT_ENUMS.cg[0]),
                    Type.Literal(CRAFT_ENUMS.cg[1]),
                    Type.Literal(CRAFT_ENUMS.cg[2]),
                    Type.Null(),
                  ],
                  { description: "library 只用库里现成的 / generate 直接出图 / off 本剧目不用插图" },
                ),
              ),
              sprite: Type.Optional(
                Type.Union(
                  [Type.Literal(CRAFT_ENUMS.sprite[0]), Type.Literal(CRAFT_ENUMS.sprite[1]), Type.Null()],
                  { description: "generate 出图 / off 不出立绘" },
                ),
              ),
              audio: Type.Optional(
                Type.Union(
                  [Type.Literal(CRAFT_ENUMS.audio[0]), Type.Literal(CRAFT_ENUMS.audio[1]), Type.Null()],
                  { description: "library 只用库里现成的 / off 不用音乐音效" },
                ),
              ),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ],
        { description: `素材来源逐类声明。${reset.description}` },
      ),
    ),
  },
  { additionalProperties: false },
);

const SET_CRAFT_DESCRIPTION = `设置这个剧目的写作参数（每轮篇幅、停止点选项数、素材来源）。改完立刻生效。

三项落在 play.json 的 craft 段，用户也能在剧目设置里看到同一份值——**用户要求改，或你们商定了新的节奏再调**，别自己顺手改。

- 省略某个字段 = 保持现状；给 null = 恢复引擎默认值。
- 素材来源逐类选：**素材资源库**（应用级 library/）里现成的不花钱、不等待，但只有库里真有的那些；
  出图完全贴合剧本，但要钱要等（立绘一张 100 秒起）。现实取舍：背景常用 library-first（库里优先），
  插图（cg）一般直接出图——库里很难正好有这一幕，立绘只能出图，音频只能取库。
- 文风、禁忌、称呼习惯这类只能拿话说的口径不在这里，写在 memory/always/craft.md。

改完回执里有新的生效值，照着它跟用户确认。`;

export function createSetCraftTool(deps: Pick<WorkshopKitDeps, "files" | "store" | "onWrite">): AgentTool<typeof setCraftParams> {
  return {
    name: "set_craft",
    label: "设置写作参数",
    description: SET_CRAFT_DESCRIPTION,
    parameters: setCraftParams,
    execute: async (_toolCallId, params: Static<typeof setCraftParams>) => {
      const patch: CraftPatch = {};
      if (params.beatLength !== undefined) patch.beatLength = params.beatLength;
      if (params.stopOptions !== undefined) patch.stopOptions = params.stopOptions;
      if (params.assets !== undefined) patch.assets = params.assets;
      if (Object.keys(patch).length === 0) {
        return textResult(
          `这次没给任何要改的字段（三个参数都可选，但总得给一个）。当前生效值：\n\n${describeCraftParams(await readCraft(deps))}`,
        );
      }

      const next = await withPlayConfigLock(deps.store.dir, async () => {
        const before = await deps.files.read("play.json");
        // 校验走 parsePlayConfig，写回用原始对象：只换 craft 这一个键，
        // 文件里其余部分（哪怕是引擎不认识的手写字段）一个字节都不动。
        const raw = JSON.parse(before) as Record<string, unknown>;
        const play = parsePlayConfig(raw);
        const merged = mergeCraftParams(play.craft, patch);
        const out = { ...raw };
        if (merged) out.craft = merged;
        else delete out.craft;
        const after = JSON.stringify(out, null, 2);
        if (after !== before) {
          await deps.files.write("play.json", after);
          deps.onWrite({ path: "play.json", before, after });
        }
        return merged;
      });

      return textResult(
        `已更新写作参数（只把与默认值不同的字段写进 play.json）。当前生效值：\n\n${describeCraftParams(resolveCraft(next))}`,
      );
    },
  };
}

/** 现状值（纯读，不经锁）：没给任何字段时用它把话说完。 */
async function readCraft(deps: Pick<WorkshopKitDeps, "files">) {
  const raw = await deps.files.read("play.json").catch(() => null);
  if (!raw) return resolveCraft(undefined);
  return resolveCraft(parsePlayConfig(JSON.parse(raw)).craft);
}
