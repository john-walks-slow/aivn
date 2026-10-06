# 漏调 beat_done 同轮追收束

## 现象

一轮里模型写完正文却没调 `beat_done`，下一轮只有 `beat_done`（零台词的空停止点轮）。
这时要在没有 `beat_done` 的位置手点一下继续，然后只写了 `beat_done`。

## 复现

`plays/test/saves/smutkbu6m`：turn12/13/14 的 history 只有 user + assistant 正文、零 toolCall，
lineage 里对应 beat12/13/14 是 `reason=no_stop` 有台词无 stop，beat15 是 `prompt + stop + beat_end` 零台词。

`apps/server/test/orchestrator.test.ts`（新增 2 例，修前皆红）：

- 首跑有台词没调 `beat_done` → 同轮追一句 → 追的那一跑补上停止点，`beat_start` 只有 1 个，台词不重复。
- 追完还不交 → 不再追，按 `no_stop` 正常封轮。

## 根因

触发是模型没调 `beat_done`（history 里连 toolCall 条目都没有，parser 没机会碰它），
但编排把问题放大了三级：

1. 纯文本轮 pi 直接收 run（无 toolCall → `hasMoreToolCalls=false` → `agent_end`），
   `onAgentEvent` 在 `agent_end` 直接 `finishBeat()`，有台词就正常封成 `no_stop`。
2. `no_stop` 只有一个「继续」出口，队列空时不开新轮，必须手点。
3. 点「继续」是纯【状态】轮，模型在里面空补一个零台词 `beat_done`，有 stop 所以过判废。

## 修复路径

`apps/server/src/orchestrator.ts` 的 `finishTurn`：无 `beat_done` 的 turn，
有真实台词（`beatHasLines`，裸散文/空轮仍走判废）且非 error/abort 时，
`steer` 一句收束指令并 `continue`，只追一次（`beatDoneNudged`，`startBeatWindow` 复位）。
追完还不交就按 `no_stop` 正常封轮，不无限追。
