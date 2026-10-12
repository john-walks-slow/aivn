# 任务：从零写一份「剧目界面样式」技能（apps/server/skills/galgame-ui-style/SKILL.md）

## 一、为什么要这份技能

工坊助手现在能给剧目换主题色（`plays/<id>/theme.css`），但它只会被界面生成的「一个色」写进去；
让它**自己写一套界面样式**时，它没有可依据的手艺：不知道有哪些令牌、不知道深浅两档怎么配、
不知道对比度怎么算、也不知道哪些颜色必须跟着主题色走、哪些是这个设计语言自带的材质色。
结果是它写出来的皮肤要么读不清、要么浅色下发黄发脏、要么把属于主题色的地方写死。

这份技能要把「怎么写到这个质量」讲清楚。参照物的质量线：`docs/features/261012-stage-style-variants/`
里那十张对照图（五种消息框 + 五种开始菜单，每种都有深色与浅色两版）。

## 二、谁在读、怎么读到

- 读者是**搭台助手**（工坊 agent，`role: "workshop"`）与剧作家（`role: "playwriter"`）——`read_skill` 两个角色都装。
- 机制（`apps/server/src/skills.ts`）：系统提示词里只列 `name` / `description` / 路径，模型觉得对上了才读全文。
  所以 **description 是路由线**：写清「什么时候该读这份、读了能干什么」。
- 技能库**只认 `apps/server/skills/<name>/SKILL.md`**，frontmatter 至少 `name` / `description` / `user-invocable: true`。
- 同目录已有六份（`galgame-visual-craft` / `galgame-play-setup` / `galgame-story-design` / `galgame-writing` /
  `galgame-bgm` / `galgame-audio`），**先读其中 `galgame-visual-craft` 定语感与详略**——它同样是「手艺 + 落地写法」，
  是这份新技能最接近的邻居。

## 三、产出的文件

**只写一个文件**：`apps/server/skills/galgame-ui-style/SKILL.md`（目录要新建）。
不要改任何别的文件；不要在仓库里留草稿。

## 四、必须自己读的材料

| 文件 | 从里面拿什么 |
| --- | --- |
| `apps/web/src/ui/playTheme.ts` | 主题色的唯一写入口：生成 `theme.css` 的内容、色板八档、`liftForDark` 的提亮配比、`readableInk` 的用法 |
| `apps/web/src/theme.ts` | 剧目主题层怎么加载（`<link>`、只覆盖 `:root` 令牌、即时生效的契约） |
| `apps/web/src/hooks/useTheme.ts` | `readableInk` 的判据（按亮度在白字/深字里取更清楚的那个） |
| `apps/web/src/app.css` | `@layer aivn-defaults` 里的令牌全表与浅色/深色两套值；`--stage-chrome-*`、`--dialog-*`、`--choice-*`、`--nameplate-*`、`--modal-*` 各组的含义 |
| `packages/stage/src/stage.css` | 舞台侧同名令牌那一份；**文件末尾那一大节是十种风格的生产实现**（`html[data-dialog-style="card\|cinema\|hud\|scroll\|velvet"]`），它的注释写明了「材质色写死 / 结构色从 accent 现推」的分工与特异度约定 |
| `apps/web/src/views/TitleView.tsx` + `app.css` 的 `.atri-menu` | 开始菜单的真实结构与类名 |
| `apps/server/src/playFiles.ts` | 工坊能写哪些文件（`theme.css` 在内的可写面） |
| `docs/features/261012-stage-style-variants/261012-stage-style-variants.summary.md` | 五种消息框 + 五种开始菜单的设计语言、各自的取舍、以及「接通时怎么接」的约定 |
| `docs/features/261012-stage-style-variants/showcase.html`、`title-showcase.html` | 十种风格的 CSS 原型（可对照每种用到的令牌与配比） |
| `apps/server/skills/galgame-visual-craft/SKILL.md` | 邻居的语感、章节粒度、详略标准 |

## 五、必须覆盖的内容（逐条都要有落点，别写成目录）

1. **一份界面皮肤长什么样**：`theme.css` 只覆盖 `:root` 上的设计令牌，不改结构、不加选择器去改布局；
   什么该写进 `theme.css`、什么该进 `memory/always/craft.md`（创作口径）、什么该进 `play.json`。
2. **令牌分层**：哪些令牌属于「界面」（`--accent` 一族）、哪些属于「舞台」（`--play-accent` 一族，舞台根自己声明
   `--accent`，从 `:root` 继承过不去）、哪些是「一层表面自己的」（`--dialog-*` / `--choice-*` / `--nameplate-*` / `--modal-*` / `--stage-chrome-*`）。
   漏给 `--play-accent*` 的症状是「界面换了色、舞台还是引擎蓝」。
3. **一个色怎么长出两套**：浅色（纸面）档与深色（暖黑）档各自的取值方式、提亮配比的来历、为什么不能同一个色两边通用。
4. **文字读不清的判据**：正文 4.5:1 / 大字 3:1 这条线怎么用；「同色既当图形又当文字」的反例
   （`--success` 与 `--success-ink` 那种成对令牌）；浅色下发黄发脏是怎么来的、怎么避开。
5. **材质色与结构色分开管**（本项目当下的口径）：书卷的纸、丝绒的酒红、电影字幕的暖金是设计语言自带的**材质色**；
   描边、名牌、选中态、焦点环这些**结构色**必须从 `--accent` 现推（`color-mix()`）。
   **但用户 2026-10-12 的要求更严一层：材质色也要掺进主题色**（例如丝绒底 `color-mix(in srgb, var(--accent) 26%, <深酒红>)`），
   否则剧目换了主题色，这几套样式看着还是「另一部剧的皮肤」。这一条要写成硬规矩：**任何一套皮肤都要让人一眼看出剧目主题色在里面**。
6. **十种参照风格**：五种消息框（card 浮岛玻璃卡 / cinema 电影字幕 / hud 战术 HUD / scroll 书卷 / velvet 丝绒幕）
   与五种开始菜单（同源配对，一组一起挑）。每种一句话点出设计语言与它靠什么立住，并指出各自的材质色该往哪个方向掺主题色。
   **默认档是 ATRI**（现在的通栏渐变），它就是「不挂任何风格」的基线，也必须是选项之一。
7. **常见坑**（都能在仓库里找到出处，写清症状与修法）：全局 `button:hover` 的 `color` 会盖掉激活态墨色；
   窄屏底缘渐变与台词条脱节；消息框在浅色下偏黄褐；`--dialog-ink-*` 在深色遮罩上反而不够亮；
   时间类 CSS 变量漏单位会让整条 `transition` 失效。
8. **自查清单**：交活前逐条过——深浅两档都看过、对比度过线、主题色真的在里面、窄屏没被挤坏、没动结构。

## 六、写作要求

- 中文；直接列条目本身，不要「真正管住的是……」「关键变化是……」这类总结与升华。
- 面向的是**要动手写 CSS 的模型**：说清后果与判据，给可抄的配比，别讲道理。
- 详略对齐 `galgame-visual-craft`（读它定标准），**控制在 250 行以内**。
- 不要复述引擎提示词里已有的内容，也不要复述工具描述。
- 不写「以用户为准」这类空话；拿不准的地方给默认取值。

## 七、交付

回复里只给三行：文件路径、这份技能管什么、它明确不管什么（边界）。
有拿不准的取舍在回复里点一句，不要为它另写文件。
