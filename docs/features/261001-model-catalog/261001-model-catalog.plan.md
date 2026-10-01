# 支持模型清单（STAGE_MODELS）

## 问题

剧目级 agent 选模型的下拉，数据源是网关 `/v1/models` 的**全量透传**。本机 cpa 网关现在返回 **143 个** id，
绝大多数不可用（`hwvolc/*`、`ms/*` 多余额耗尽），用户在 143 项里翻两个 agent 各要跑哪个。

服务端配置面只有单个 `STAGE_MODEL_ID`（= 默认模型），没有「这台部署支持哪些模型」这个概念。

## 方案

新增 `STAGE_MODELS`：逗号/空白分隔的模型 id 白名单。配了就只给这些，不配就是现在的全量。

- 清单**收窄**网关清单，不取代它：网关 `/v1/models` 仍是「哪些模型真能发出去」的真相，
  `STAGE_MODELS` 只决定「给用户看哪几个」。清单里的 id 网关没有 → 报错点名，
  不静默丢掉（下拉里摆一个发不出去的模型，比整个下拉挂掉更让人误会）。
- 顺序按配置里写的来（`sort()` 出来的字母序对「便宜→贵」这种配法没有信息量）。
- `STAGE_MODEL_ID` 不变，仍是「跟随服务端默认」那一项。
- 设置面板（`#/settings`）模型网关组加一个文本框，直接写回 `.env`，与 `STAGE_MODEL_ID` 同一块。
- 老剧目不受影响：`play.json` 里已有的 `agents.*.model` 照旧能用（`resolveCpaModel` 本来就接受
  任意网关 id）。工坊「Agent」页的下拉里，清单外的当前值额外渲一项标「不在支持清单里」，
  别让 select 显示成空白。

## 改动

| 文件 | 改什么 |
| --- | --- |
| `apps/server/src/config.ts` | `ServerConfig.models: string[]` + `parseModelList()`（导出让设置面板复用同一份解析） |
| `apps/server/src/provider.ts` | `supportedModels(gateway, allow)` 纯函数：收窄 + 点名缺失 |
| `apps/server/src/playhouse.ts` | `gatewayModels()` 缓存网关原始清单，收窄在读时做 |
| `apps/server/src/configApi.ts` | `SettingsView.model.models`（`STAGE_MODELS` 原文，文本即传输形态，无损编辑） |
| `apps/web/src/api.ts` | `Settings.model.models: string` |
| `apps/web/src/views/SettingsScreen.tsx` | 模型网关组加「支持的模型」文本框 |
| `apps/web/src/workshop/AgentPane.tsx` | 清单外的当前值补一项进下拉 |
| `README.md` | `.env` 表、设置面板清单、Agent 页「模型」行 |

## 不做

- 不给清单项配元数据基座（别名模型 `low`/`medium` 不在 pi-ai 内置目录，思考档位与上下文窗口
  仍沿用 `STAGE_MODEL_BASE`）。要修得给每项加 base 字段，是另一种配置形状。
- 不动 `resolveCpaModel`：play.json 里填清单外的 id 仍然发得出去，不拦。

## 验证

- 单测：`parseModelList` 解析（空/空格/去重）、`supportedModels`（收窄+顺序+缺失报错）、
  `SettingsFile` 读写往返。
- 实机：起 dev（`STAGE_MODELS` 用进程环境变量注入，不动共享的 `.env`），
  看工坊「Agent」页下拉从 143 项收到几项、设置页文本框保存正确。