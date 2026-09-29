import type { EngineStateSnapshot } from "@stage-ai/core";
import type { PlayConfig } from "@stage-ai/core";
import type { PlayMemory } from "./memory.js";

/** 素材清单（store.listAssets 原样；keys: backgrounds/cg/sfx/bgm/sprites/<charId>）。 */
export type AssetManifest = Record<string, string[]>;

/**
 * Playwriter 系统提示词 = 三区装配的 A 区（固定前部，KV cache 前缀稳定）。
 * 每轮变化的状态走 user 消息【状态】区（B 区 append-only），见 orchestrator。
 * 记忆层（D7）：craft/premise/index 标题列表在 runtime 构建时读入——纪元内冻结，工坊热改走 reload。
 */
export function buildSystemPrompt(
  play: PlayConfig,
  assets: AssetManifest = {},
  memory?: PlayMemory,
  arcIds: readonly string[] = [],
): string {
  const characters = play.characters
    .map((c) => {
      // 差分列表优先取角色卡 sprites 键名（前端按它解析立绘）；未配置映射时回退磁盘文件 stem
      const expressions =
        c.sprites && Object.keys(c.sprites).length > 0
          ? Object.keys(c.sprites)
          : (assets[`sprites/${c.id}`] ?? []).map((f) => f.replace(/\.\w+$/, ""));
      return `### ${c.name}（id: ${c.id}）\n${c.persona}${c.voice ? `\n音色：${c.voice}` : ""}${
        expressions.length > 0 ? `\n立绘差分 expression：${expressions.join(" | ")}` : ""
      }`;
    })
    .join("\n\n");

  const stems = (key: string): string[] => (assets[key] ?? []).map((f) => f.replace(/\.\w+$/, ""));
  const bg = stems("backgrounds");
  const bgm = stems("bgm");
  const sfx = stems("sfx");
  const assetSection = [
    bg.length > 0 ? `\n# 可用背景 bg\n\n${bg.join(" | ")}——scene 的 bg 只能取这些 id。\n` : "",
    bgm.length > 0 ? `\n# 可用音乐 bgm\n\n${bgm.join(" | ")}\n` : "",
    sfx.length > 0 ? `\n# 可用音效 sfx\n\n${sfx.join(" | ")}\n` : "",
  ].join("");

  const premise = memory?.premise.trim() || play.premise;
  const craftSection = memory?.craft.trim()
    ? `\n# 剧艺守则（craft）\n\n${memory.craft.trim()}\n`
    : "";
  const cards = memory?.visibleContext(arcIds) ?? [];
  const indexSection =
    cards.length > 0
      ? `\n# 记忆索引（按需查详情）\n\n${cards.map((c) => `- [${c.layer}] ${c.name}：${c.summary}`).join("\n")}\n\n需要某条完整内容时调用 read_memory_detail 工具（传名称）。历史往事用 search_archive 检索。\n`
      : "";

  return `你是一部视觉小说的剧作家（playwriter），实时为一部正在"直播"的游戏写剧本。
玩家既是主角（通过【玩家表态】入戏回应），也是导演（通过【导演注】调整演出方向）。

# 剧目设定

${premise}

# 角色表

${characters}
${assetSection}${craftSection}${indexSection}
# 剧本格式（Stage DSL，必须严格遵守）

你输出的每一行都是剧本。指令用 XML 标签，台词是标签外的原生文本。

## 场景与立绘指令（必须出现在对应台词之前）

<scene bg="背景id" bgm="音乐id" ambient="环境音id" transition="fade"/>
<actor id="角色id" pos="left|center|right" expression="表情id" action="enter|leave|shake"/>
<sfx src="音效id" volume="0.5"/>
<cg id="cgid" caption="插图说明"/>
<preload_asset type="bg|cg|sprite" prompt="生图描述" id="资源id"/>

## 台词（三类，正文为原生文本，不要转义）

<say id="角色id" mood="情绪">台词正文，可以换行。</say>
<narrate>旁白正文。</narrate>
<thought id="角色id">（内心独白）</thought>

## 停止点（玩家交互）

<stop type="choice">
<option value="选项值">选项文本</option>
<option>另一个选项</option>
</stop>
<stop type="free" placeholder="输入框提示语"></stop>
<stop type="pause"></stop>

## 结束节拍

本节拍内容写完——交互停止点之后，或一幕自然写完——立即调用 beat_done 工具（不要与其他工具同批调用）。stop 标签之后不要再输出任何内容。

# 演出准则

1. 指令先于台词：先铺场景/立绘，再写这一拍的台词。
2. 角色情绪/表情变化时，用 actor 指令同步切换 expression 差分——say 的 mood 只是文字标注，不驱动立绘。
3. 一拍 3~8 行台词为宜：一小段有起伏的演出，然后停在停止点等玩家。
4. 展示而非陈述：情绪走动作、语气与台词本身，不用旁白直接解释心理。
5. 每轮 user 消息顶部有【状态】区（好感度/场景/进度），信任它作为最新世界状态。
6. 【玩家表态】是主角在戏内说的话/做的选择；【导演注】是导演指示，遵守但不要复述或跳出戏外回应。
7. 玩家表态简短时也保持剧情推进：让角色主动给出反应与新信息，不要原地等待。
8. 玩家表态标注「本轮未作回应」时：不要替玩家编造台词或行动，让角色自然接戏并在合适时机再给回应机会。
9. 好感度变化、重要伏笔等通过演出自然体现，后续【状态】区会反映。`;
}

/** user 消息【状态】区（B 区，每轮变化但 append-only）。stateFiles = always/state 谱系级内容（D7）。 */
export function renderStateSection(
  state: EngineStateSnapshot,
  scene: string,
  stateFiles: Record<string, string> = {},
): string {
  const affinity = Object.entries(state.affinity)
    .map(([k, v]) => `${k} ${v}`)
    .join(" | ");
  const flags = Object.entries(state.flags);
  return [
    `场景：${scene}`,
    affinity ? `好感度：${affinity}` : null,
    flags.length > 0 ? `旗标：${flags.map(([k, v]) => `${k}=${v}`).join(" | ")}` : null,
    `进度：第 ${state.turn} 节拍`,
    stateFiles.scene?.trim() ? `场景细节：${stateFiles.scene.trim()}` : null,
    stateFiles.threads?.trim() ? `活跃剧情线：${stateFiles.threads.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
