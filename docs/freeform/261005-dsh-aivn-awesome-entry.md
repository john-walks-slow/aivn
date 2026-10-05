# dsh-aivn 的 awesome 投稿草稿（发布后满 1 天再提）

投稿对象：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
**一个文件就是全部投稿**：往 `data/plugins/john-walks-slow__dsh-aivn.yml` 加下面这份内容，
两个 README 由脚本生成，不要手改。

## 条目

```yaml
url: https://github.com/john-walks-slow/dsh-aivn
name: john-walks-slow/dsh-aivn
category: fun
description:
  en: 'Turns a workspace into a visual-novel play inside DeepSeek Harness: two agent presets (a playwright that writes Stage DSL, a stage-hand that prepares the play), a Stage tab in the conversation that performs the DSL live (backgrounds, sprites, dialogue bar, stop-point choices), per-beat injection of the play premise, cast, asset list, writing parameters and memory index into the playwright system prompt, six tools (create_play, get_readiness, list_library, set_craft, update_state, beat_done), a /new-play command, and line-by-line text-to-speech through Fish Audio with a voice toggle, prefetch backpressure and per-line replay.'
  zh: '把工作区变成一部视觉小说：两个 agent 预设（写 Stage DSL 的剧作家、备料的搭台助手）、对话页里的「舞台」tab 实时演出 DSL（背景、立绘、台词条、停止点选项），剧作家的系统提示词按轮注入剧目的前提、角色表、素材清单、写作参数与记忆索引，另有六个工具（create_play / get_readiness / list_library / set_craft / update_state / beat_done）、一条 /new-play 命令，以及走 Fish Audio 的逐句语音（开关、预取背压、重听）。'
```

## 为什么这么写

- **描述里的每个数字与名字都对得上代码**：工具就是那六个（`src/playwriter/tools/` +
  `src/tools/create_play.ts`）、命令就是 `/new-play`、注入的段落就是前提 / 角色表 / 素材清单 /
  写作参数 / 记忆索引 + 【状态】。维护者会拿描述对着源码核，夸大是打回主因。
- **分类**：`fun` 最贴（它做的是「把对话页变成一部能演的戏」）。备选 `ui`（它加了
  `conversation.view` 上的一个视图）与 `voice`（它带 TTS）——但这两个都只说了一半。
  分类选得不准不会被拒，维护者会直接改。
- **关键词密度**：dsh-market 的搜索只索引 awesome 条目的 name / npm 名 / owner / 双语描述 /
  分类，**README 与 npm keywords 不参与**。所以六条工具名、`Stage DSL`、`visual novel`、
  `text-to-speech`、`Fish Audio` 都写进描述里，而不是留给 README。

## 提 PR 前逐项核对

- [ ] 仓库已公开，且加了 topic `dsh-plugin`（自动市场靠它收录，不需要提交）。
- [ ] 仓库**创建满 1 天**（CI 自动查；刚建仓当天提会被拒，隔天再来即可）。
- [ ] `package.json` 声明了 `dsh.bundle`（只声明 `dsh.client` 会被拒）——本仓库两者都有。
- [ ] `screenshots.json` 在仓库根、1–8 张、路径不跳出插件目录——已就位（`screenshots/screenshot-1.png`）。
- [ ] npm 包已发布且 `repository` 指回本仓库（下载量才关联得上）；**发不发 npm 都不影响收录**。
- [ ] 一个 PR ≤ 3 条；只改自己这一条，别碰别人的。
