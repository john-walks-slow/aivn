# `@aivn/server` 7 条红的定位与修复方案

- 侦察现场：`/root/projects/stage-ai-shared`（worktree，HEAD = `c8595bb9`，= main 的 c8595bb9；main 之后两笔 `338df6e0` / `ec46b1f0` 均不碰本次涉及的文件，所以 main 上同样红）。
- 复现：`cd apps/server && npx vitest run test/voice.test.ts test/workshopPrompt.test.ts` → `2 failed | 7 tests failed`。
- 本报告**只做诊断，未改动仓库任何文件**（`git status` 仅剩开始前就存在的未跟踪目录 `docs/features/261009-aivn-agent-package/`）。验证脚本写在 `/tmp/aivn-shared-research/`，直接吃 `apps/server/dist` 与 `packages/core/dist`（两者 mtime 均晚于对应 src，是新鲜的）。

## 结论速览

| # | 用例（文件:行） | 归因 | 引入提交 | 修哪边 |
|---|---|---|---|---|
| 1 | voice.test.ts:107 分句预取 → 2 条 audio_ready | 改了行为没改测试（假流没跟「同轮追收束」） | `836be2b4`（2026-10-05） | 改测试夹具 |
| 2 | voice.test.ts:124 省略号 → 1 条 | 同上 | `836be2b4` | 改测试夹具 |
| 3 | voice.test.ts:145 paused→resume → 4 条 | 同上 | `836be2b4` | 改测试夹具 |
| 4 | voice.test.ts:193 TTS 失败 → 1 条 ready / 1 条告警 | 同上 | `836be2b4` | 改测试夹具 |
| 5 | workshopPrompt.test.ts:87 `defaultVoiceId` | 改了行为没改测试（play.json 字段表已下沉 skill） | `8a08d4fc`（2026-10-09） | 改测试（并指出与 workshop.test.ts:399 互相矛盾） |
| 6 | workshopPrompt.test.ts:105 `**交给用户落盘**` | 改了行为没改测试（措辞改过） | `8a08d4fc` | 改测试 |
| 7 | workshopPrompt.test.ts:123 skill 关仍有 `read_skill` | **测试对、代码回归**（新加的 read_skill 指针漏了能力位门控） | `8a08d4fc` | **改代码** |

没有 flaky、没有环境问题：7 条都是确定性的，重跑稳定。

---

## 族一：voice.test.ts 4 条（数量恰好翻倍）

### 1. 断言原文与期望语义

| 测试:行 | 断言 | 期望语义 |
|---|---|---|
| voice.test.ts:107 | `expect(ready).toHaveLength(2)` | 一条 `<say>` 里的两句话各产生一条 `audio_ready`（`ready[0]/[1]` 的 seq= say_start seq，phrase=0/1） |
| voice.test.ts:124 | `expect(ready).toHaveLength(1)` | 句首省略号不合成，`say_end` 冲刷出的无尾标点残余只合成 1 条 |
| voice.test.ts:145 | `expect(ready).toHaveLength(4)` | paused 期间零合成，resume 后把 4 个短语按序补发 |
| voice.test.ts:193 | `expect(ready).toHaveLength(1)` + `193/194: errors).toHaveLength(1)` | 失败句丢弃只告警一次，不阻塞事件流 |

报错形态：`2 but got 4` / `1 but got 2` / `4 but got 8` / `1 but got 2` —— **全部恰好 ×2**。

### 2. 被测代码现在实际的行为 + 翻倍的确切机制

**不是**「两路事件都在被收集」，也**不是**分句/冲刷被调两次。翻倍发生在**模型被跑了两次**这一层：

- `apps/server/src/orchestrator.ts:644-661`（`buildAgent` 的 `agent.finishTurn`）：一轮写完正文却没调 `beat_done` 时，若 `this.busy && this.beatHasLines` 且还没追过，就 `agent.steer(BEAT_DONE_NUDGE)` 并返回 `{action:"continue"}` —— **同一轮里再跑一次模型**（`BEAT_DONE_NUDGE` 见 orchestrator.ts:74-80，`beatDoneNudged` 见 397/1968）。
- `voice.test.ts:10-36` 的本地假流 `fakeStream(text)` 是「无状态恒返回同一份 DSL」的：第二次被调用时又吐一遍**一模一样的剧本正文**。
- 第二次正文走同一条 `text_delta → parser.feed`（orchestrator.ts:1990-1991）→ `onStageEvent`（2252）→ `feedVoice`（2267/2287-2301），于是每个 `say_text` 增量被喂第二遍，`VoicePipeline` 再分句、再合成、再 `audio_ready`。

用 dist 直接跑假流实测（`/tmp/aivn-shared-research/probe-agent-events.mjs`）：

```
agent event counts: { turn_start: 2, turn_end: 2, 'message_update:text_delta': 12, ... }
parser.feed calls: 12          # 同一串 delta 被喂了两遍
stage event kind counts: { say_start: 4, say_text: 8, say_end: 2, narrate_text: 4, ... }
audio_ready: 4 ; calls: [第一句。, 第二句！, 第一句。, 第二句！]
```

即：**一路事件 × 模型跑两次**。`audio_pending`（state="started"）也同步翻倍，但测试只数 `audio_ready`（orchestrator.ts:596-601 把 started 映射成 `audio_pending`）。

### 3. 归因

**「改了行为没改测试」**，与 apps/web 那 5 条同类：

- 行为改动：`git log -S beatDoneNudged` → `836be2b4 fix(server): 漏调 beat_done 同轮追收束一次`（2026-10-05 10:01）。
- `apps/server/test/voice.test.ts` 最后一次改动是 `fc897a21`（2026-10-04），**早于**该提交，其假流从未跟上「同一轮会再跑一次模型」。
- 该提交只补了 `apps/server/test/orchestrator.test.ts` 的两条（:331 / :355），没动 voice 夹具。
- 反证：给假流补上 `beat_done` 后（见下）7 条全绿 → 生产代码的翻倍只在「假流不会收束」时出现。真模型被 steer 之后按设计空补一个 `beat_done`（orchestrator.ts:74-80 的注释），不会重演正文。

### 4. 最小修复方案（只改测试）

改 `apps/server/test/voice.test.ts` 的本地假流（10-36 行），让它像真模型那样在同一轮交出 `beat_done`——**不要**把期望数字改成 4/2/8/2，那等于把「每句合成两遍」写成正确行为。

```ts
// voice.test.ts:21-30 区域
const finalMessage: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "text", text },
    // 假流也必须收束：漏调 beat_done 时 orchestrator 会在同轮 steer 再跑一次模型
    // （orchestrator.ts finishTurn），无状态的假流会把同一份 DSL 再吐一遍——台词语音因此翻倍。
    { type: "toolCall", id: "call-1", name: "beat_done", arguments: {} },
  ],
  api: "openai-completions",
  ...
  stopReason: "toolUse",
};
```

`stopReason` 同时从 `"stop"` 改成 `"toolUse"`。一处改动覆盖全部 5 条 voice 用例（含 :161 内联构造的那条，它复用同一个 `fakeStream`）。

等价替代写法：直接用共享夹具 `helpers.ts:106` 的 `createFakeStreamFn([{ text: dsl, beatDone: true }])`（它本来就会补 `beat_done`，见 helpers.ts:165-180）。两者取一即可。

**已验证**（吃 dist，未改仓库）：补 `beat_done` 后
- 两句话场景 → `audio_ready = 2`，`calls = [第一句。, 第二句！]`，`say_start:1 / say_text:4 / say_end:1`；
- 省略号场景 → `1`，url 含「真的吗，是这样啊」，phrase=0；
- paused 场景 → 暂停期 `0`，resume 后 `4`，phrase=[0,1,2,3]；
- 失败场景 → `ready=1`、`console.warn=1`、`say_end` 仍在。

### 5. 风险

- 低。但要注意一个**真实残差**：追收束本身没有「第二次不得再产出正文」的护栏——真模型若无视 steer 又写了一段，舞台上会真的重演一遍（含语音）。这不是本次修复引入的，也不该由 voice 用例来钉；`orchestrator.test.ts:331` 已覆盖追收束语义。修完 voice 用例后这条残差依旧无人守，值得单开一条 issue（不属于本次 7 条红的范围）。
- 反过来说，把数字直接改成 4/2/8/2 会**掩盖真实回归**：万一将来 `finishTurn` 的门控写坏、或者 `beatDoneNudged` 失效导致追收束跑两遍，测试就再也发现不了。

---

## 族二：workshopPrompt.test.ts 3 条

三条都指向同一笔提交：`8a08d4fc refactor(workshop): 备料流程下沉成 skill，补齐两条线的 skill 缺口`（2026-10-09 13:01，worktree 基线里已有）。该提交把 workshop.ts 里两段硬编码正文（3527 字符）下沉到 `apps/server/skills/galgame-play-setup/SKILL.md`，**同时更新了 `workshop.test.ts` 的三条断言、却漏了 `workshopPrompt.test.ts`**。`git show --stat 8a08d4fc` 的文件清单里没有 `workshopPrompt.test.ts`。

### 5) `defaultVoiceId`（workshopPrompt.test.ts:84-92）

**断言原文与期望语义**

- :87 `expect(prompt).toContain("defaultVoiceId")`
- :88 `"voiceLanguage"`、:91 `"静默消失"`、:89 `` "不要整篇 `write` 覆盖" ``
- 语义：把「play.json 哪些字段缺了会静默降级」这类代价写进提示词，并要求定点 `edit` 而非整篇 `write` 覆盖。

**现在实际行为**：`apps/server/src/workshop.ts:229-251`（`writingPoints`）已把 play.json 字段表整体删掉，只留指针 `**全文在 skill \`galgame-play-setup\` 里**（read_skill 读它）`（:238-239）；同时落盘那句措辞改成了「**别**整篇 `write` 覆盖」（:249-250）。经 dist 实测：prompt 里 `defaultVoiceId` / `voiceLanguage` / `静默消失` / `` 不要整篇 `write` 覆盖 `` 四个字面量全无，断言在第一个就炸。

**归因**：改了行为没改测试。知识没丢，是**搬家**了——`apps/server/skills/galgame-play-setup/SKILL.md:75-86` 逐条含 `voiceLanguage`、`defaultVoiceId`、`静默消失`、`` 不要整篇 `write` 覆盖 ``（实测 `readSkill("galgame-play-setup")` 四条全 true）。

**互相矛盾（要点名）**：同一提交新写的 `apps/server/test/workshop.test.ts:397-399` 钉的是「提示词只留 `galgame-play-setup` 指针、全文在 skill」，而**没被更新的** `workshopPrompt.test.ts:87` 钉的是「提示词正文里要有字段表」。两条不可能同时为真——冲突的一方必须按 `8a08d4fc` 已经选定的方向（下沉）改写。

**最小修复（改测试）**：把 :84-92 那条改写成与 `workshop.test.ts:402-417` 同款的**配对断言**（提示词留指针、语义在 skill）：

```ts
it("列出会被静默降级的字段，并要求定点改而不是整篇覆盖", async () => {
  const prompt = await buildWorkshopPrompt({ ...CTX, can: caps(), voiceLanguage: "ja" });
  expect(prompt).toContain("play.json");
  // 字段表已下沉 skill：提示词留指针，语义由下面这半条守（否则「下沉=删除」没人拦）
  expect(prompt).toContain("galgame-play-setup");
  const skill = await readSkill("galgame-play-setup");
  expect(skill.content).toContain("defaultVoiceId");
  expect(skill.content).toContain("voiceLanguage");
  expect(skill.content).toContain("不要整篇 `write` 覆盖");
  expect(skill.content).toContain("静默消失");
});
```

文件头需加 `import { readSkill } from "../src/skills.js";`（`readSkill` 是 `src/skills.ts:41` 的导出）。

**风险**：低，且比原断言更强（同时钉住指针与 skill 内容）。唯一要注意的是别把「提示词里不再有字段表」当成可以删守卫——`workshop.test.ts:402` 已守住 skill 侧。

### 6) `**交给用户落盘**`（workshopPrompt.test.ts:96-109）

**断言原文与期望语义**：:105 `expect(prompt).toContain("**交给用户落盘**")`。语义：「改剧目文件」关掉时，提示词要明确告诉模型——产出物与落盘方式换成清单式，要改就交给用户。

**现在实际行为**：旧代码在 `setupFlow` 的 files:false 分支写着 `4. **交给用户落盘**：…`（见 `git show 8a08d4fc -- apps/server/src/workshop.ts` 的删除行）。新代码把这段挪进 `fallback`（workshop.ts:189-191）并**改了措辞**：`**本剧目没给你写口**（Agent 页关了「改剧目文件」）：把 … 整理成一份「改哪个文件、写什么」的清单交给用户，让他在工坊里自己改…`；另一处在 `responsibilityRules`（:62-63）写 `**这条路上没有给你写口**`。dist 实测：`**本剧目没给你写口**` = true、`清单交给用户` = true、`**交给用户落盘**` = false。同一条用例里 99-104 行（不含 `# 对话风格` / `set_craft` / `defaultVoiceId` / `assets/manifest.json` / `这条路上没有给你写口`）全部通过，只有 :105 这条字面量断言炸。

**归因**：改了行为没改测试（测试钉的是被有意改写掉的旧措辞），不是知识丢失。

**最小修复（改测试）**：:105 换成新措辞，并顺带钉住语义：

```ts
expect(prompt).toContain("**本剧目没给你写口**");
expect(prompt).toContain("清单交给用户");
```

**风险**：几乎为零。若坚持保留旧字面量，就得改代码把措辞改回去——那是一次无意义的回退，不推荐。

### 7) `read_skill`（workshopPrompt.test.ts:118-124）——**唯一的代码回归**

**断言原文与期望语义**

- :121-123 `on` 含 `galgame-visual-craft`；`off` 不含 `galgame-visual-craft`，且 `off` **不含 `read_skill`**。
- 语义（describe 标题）：「能力关掉之后不再教它调那个工具」——`can.skill=false` 时技能清单块整块不注入，提示词里也不许再出现 `read_skill`。

**现在实际行为**：`can.skill` 确实门控了两处——技能清单（workshop.ts:136 `ctx.can.skill ? await skillsPrompt() : ""`）与出图章节的 skillRule（:315-319）。但 `8a08d4fc` 新加的两处 `read_skill` **没有门控**：

- `workshop.ts:194`（`setupFlow`，无条件）：`**先 read_skill("galgame-play-setup") 再动手**`
- `workshop.ts:239`（`writingPoints`，只受 `can.files` 门控）：`（read_skill 读它）`

dist 实测 `caps({skill:false})`：`read_skill` = true、`galgame-play-setup` = true、`galgame-visual-craft` = false。

**为什么这是代码回归而不是陈旧用例**：

1. `read_skill` 这个工具由 `skill` 能力位授权（`apps/server/src/agentkit/kit.ts:197-202`：`id:"skill"`, `tools:["read_skill"]`；装配见 :357 `enabledToolsFor`）。能力位关 = 工具不注册。
2. 这正是 `scripts/check-agent-contract.mjs` 第 1 条守卫的精神（「提示词里点名的工具，装配面上必须真的有——能力位关着时不能教它调」），也与同族的 `test/prompt.test.ts:304-308`（剧作家没有 read_skill 就不许出现该词）完全一致。
3. 该用例自己就是 `8a08d4fc` 里那套「下游下沉、门控留提示词」设计的一部分（提交信息：「skill 恒列、没有能力位门控，所以『本剧目有没有写口』必须由提示词说」）——作者只给 `can.files`/`can.image`/`can.library` 收了条件，漏了 `can.skill`。

**最小修复（改代码，`apps/server/src/workshop.ts`）**：给两处新指针补上 `ctx.can.skill` 门控。

- `setupFlow`（:192-201）：把 :194-196 那段指针整段收进条件，skill 关时只留「一句话概括」那行（该行本身不含工具名）：

```ts
const pointer = ctx.can.skill
  ? `用户要开新剧目、或要改现有剧目的设定时，**先 read_skill("galgame-play-setup") 再动手**——
四步走、premise／角色卡／记忆卡／素材表各写什么、play.json 有哪些字段、写作参数与创作口径
怎么分，全在那份全文里。别凭印象开写。

`
  : "";
return `# 设定流程（这是你的工作方式，不是可选建议）

${pointer}一句话概括：**先问清骨架 → …**
…
```

- `writingPoints`（:236-250）：把 :238-239 的「全文在 skill …（read_skill 读它）」一句收进 `ctx.can.skill` 条件，关掉时换成不含工具名的说法（例如 `各文件的写法要点：`），其余（craftNow / voicePickHint / edit-不覆盖 / 库里导入）原样保留。

改完 `caps({skill:false})` 的首个 prompt 与 :121-123 三条断言全过；`caps()`（默认 skill 开）仍保留指针，`workshop.test.ts:399` / `416` 不受影响；`check-agent-contract.mjs` 7 项仍过（它只查「名字在装配面上存在」，不查门控）。

**风险**：`can.skill=false` 时，备料流程的全文（含 play.json 字段表、四步走）在提示词里彻底不可达——这是关掉「技能库」的固有代价，不是本次修复造成的。若产品上不接受这个代价，替代方案是「skill 关时把 SKILL.md 内联进提示词」，那是另一个更大的设计决定，不在最小修复范围内。**不要**用「删掉 :123 这条断言」来消红——那正好把守卫拆掉，回到 `8a08d4fc` 想防的那类漂移。

---

## 复现与证据清单

```bash
# 红
cd /root/projects/stage-ai-shared/apps/server
npx vitest run test/voice.test.ts test/workshopPrompt.test.ts     # 7 failed

# 我的验证脚本（只读 dist，未改仓库）
node /tmp/aivn-shared-research/probe-agent-events.mjs    # 翻倍机制：parser.feed ×2、turn ×2
node /tmp/aivn-shared-research/probe-nudge-fix.mjs       # 假流补 beat_done → ready 2（正确）
node /tmp/aivn-shared-research/probe-verify-fix.mjs      # 省略号 1 / paused 0→4 / 失败 1+1 全对
node /tmp/aivn-shared-research/probe-workshop.mjs        # skill:false 仍有 read_skill；skill 文件含四条语义
node /tmp/aivn-shared-research/probe-parser.mjs          # 排除「解析器自己吐两遍」
```

原始终端输出留存：`/tmp/aivn-shared-research/raw-test-output.txt`。
