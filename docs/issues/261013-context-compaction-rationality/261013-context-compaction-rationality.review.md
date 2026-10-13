# 检视报告

## 概要

本次检视覆盖 `compaction.ts`、`rebuild.ts`、`llm.ts`、`orchestrator.ts`、`workshop.ts`、`workshopSession.ts`、`playhouse.ts` 及对应回归测试，并对照排障报告核查 P1–P6 与第一轮 B1、S1、S2、S3、N3 的修复。整体架构与既有设计一致：舞台压缩随谱系快照投影，工坊压缩落线程元数据；当前未发现会阻断交付的核心数据丢失问题，但摘要“仅标题”判定和摘要转录裁剪仍有改进空间。

## 需求对齐

总体满足需求：

- `estimateMessageTokens` 对 `system` 消息直接使用 `localTextTokens(prose)`，不再错误扣除 `chars/4`；现有测试覆盖中英文混合计量。
- `COMPACTION_SEED_HEADER` / `COMPACTION_SEED_FOOTER` 已由 `rebuild.ts` 与 `compaction.ts` 共用，二次压缩按固定尾句定位旧前情提要；不再使用旧报告所指的任意 `\n\n【` 分隔，因此第一轮 B1 已修复。
- `completeText` 支持 `maxTokens`，舞台与工坊摘要使用 `SUMMARY_MAX_TOKENS = 4096`，工坊摘要请求透传本轮中止信号。
- 工坊历史回灌优先使用 `parts` 的文本和工具注脚，素材路径也会进入上下文；旧消息无 `parts` 时回退 `message.text`。`lastAssistant` 从 Agent 初始消息长度开始汇总本轮全部 assistant 步骤，N3 已落实。
- `carryOver` 不再执行 8000 token 无摘要硬截断；`buildAgent` 会过滤传入的 `system` 消息。
- 舞台压缩成功后立即更新当前路径最近快照，避免判废重演时恢复旧压缩状态并重复调用摘要模型。
- 工坊压缩参数由 `getRunConfig` 每轮读取，并与工坊模型上下文窗口取较小值；测试覆盖动态收紧阈值后的压缩行为。

与排障报告的差异：旧 review 中的 B1 已不再成立，当前代码使用固定 `COMPACTION_SEED_FOOTER` 定位边界，不能继续将其列为阻塞问题。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | [apps/server/src/compaction.ts:181-202](../../../apps/server/src/compaction.ts#L181-L202) | “仅通用标题无正文”只覆盖了 `GENERIC_TITLES` 中的标题。输出 `# 前情提要\n## 剧情进展` 时，`剧情进展` 不在集合内，会被当作一句有效摘要写入压缩记录；类似仅有 `## 已确定`、`## 未回收伏笔` 的结构标题也可能产生同类误判。这样虽不会直接丢原文，但会把无事实的占位文本作为已压缩前情提要，降低后续模型判断可靠性。 | 增加“至少存在一行非标题正文”的判定：去除 markdown 标题、空行和已知结构性分节标题后，若没有实质文本则返回 `（本纪元无有效摘要）`；补充多种只有分节标题的测试。 |
| S2 | [apps/server/src/compaction.ts:279-292](../../../apps/server/src/compaction.ts#L279-L292) | 70%/30% 头尾保留已解决了只保留开头导致拍末 `<stop>` 丢失的问题，但换行边界调整仍可能在单行很长时从 markdown/DSL 标签内部落刀，且 `head.length` 使用 UTF-16 长度而其它阈值使用码点长度，含 emoji 或非 BMP 字符时边界判断口径不完全一致。该函数当前只用于摘要输入，不会直接破坏运行时剧本，但会降低摘要模型识别停止点和结构标签的稳定性。 | 统一按码点长度计算边界，并在可行时优先按完整换行或完整标签边界调整；增加长单行、长 `<say>`、长 `<stop options>`、emoji 混排的回归用例。 |
| S3 | [apps/server/src/workshopSession.ts:531-547](../../../apps/server/src/workshopSession.ts#L531-L547)、[apps/server/src/playhouse.ts:1382-1403](../../../apps/server/src/playhouse.ts#L1382-L1403) | 当前每轮配置优先使用 `turnCompaction`，静态 `opts.compaction` 作为回退，产品路径中 `getRunConfig` 总会返回动态配置，因此行为正确；但如果未来某轮动态配置返回 `undefined`，`freshTurnContext` 不会清空旧的 `turnCompaction`，会继续沿用上一轮设置，形成隐蔽的生命周期状态残留。 | 明确 `turnCompaction = compaction` 而不是仅在 truthy 时赋值，或统一压缩配置的单一来源；补充“配置从启用变为未配置/禁用”的测试。 |
| S4 | [apps/server/src/orchestrator.ts:2003-2024](../../../apps/server/src/orchestrator.ts#L2003-L2024) | 压缩记录更新后调用 `persist()`，但该方法本身是调度异步保存而非等待保存完成。摘要已进入内存和当前 Agent，若进程恰好在调度与实际写盘之间退出，最近一次压缩记录仍可能未落盘。现有架构将此作为持久化窗口，未构成当前功能逻辑错误，但属于压缩结果的可靠性残余风险。 | 后续可让压缩路径等待一次快照持久化完成，或让 `persist` 返回并纳入轮边界 `whenIdle` 的等待链；补充“压缩后立即重建/关闭”的持久化回归。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | [apps/server/src/compaction.ts:86-104](../../../apps/server/src/compaction.ts#L86-L104) | `system` 消息目前只计量文本/思考散文，若未来 system content 引入图片或其它结构化块，仍不会计入结构开销；当前调用方式只使用文本 system prompt，暂未见实际影响。 | 保持现状；若 system prompt 支持多模态块，再为非文本块补独立计量。 |
| N2 | [apps/server/src/compaction.ts:237-246](../../../apps/server/src/compaction.ts#L237-L246) | 固定尾句切分已正确解决旧报告 B1 的误切问题，但若历史数据由其它版本生成、缺少该尾句，函数会把整条首拍内容原样作为转录文本，无法区分旧摘要和本拍输入。这是兼容旧格式的可预期退化，不影响当前版本生成的 seed。 | 可在迁移或兼容策略明确后，针对缺尾句的旧消息增加诊断标记；不要退回到任意 `\\n\\n【` 猜边界。 |
| N3 | [apps/server/src/workshop.ts:621-645](../../../apps/server/src/workshop.ts#L621-L645) | `lastAssistant` 依赖“构造 Agent 后新增消息都属于本轮”的约定。当前代码已正确记录 `initialCount`，因此 N3 已修复；若底层 Agent 将来在 prompt 前插入其它 assistant 消息，仍需重新确认起点语义。 | 保持当前显式 `initialCount` 做法；若 Agent API 提供 turn id 或消息批次标识，可进一步改用显式批次边界。 |
| N4 | [apps/server/src/compaction.ts:421-429](../../../apps/server/src/compaction.ts#L421-L429) | `capDigest` 为保留最新内容而从尾部截断，可能丢掉早期摘要中的角色约束或长期禁忌；这符合当前 6000 字封顶策略，但摘要模型被要求记录用户偏好，长期内容仍有被挤出的风险。 | 后续可将固定的长期约束与事件摘要分区，或在封顶前保留结构化的“偏好/禁忌”段；不建议在本次修复中扩大范围。 |

## 准入结论

**结论**：`条件准入`

**说明**：本次列出的核心修复已落实，旧报告中的 B1 已修复，未发现必须阻断合并的实现错误。建议优先补齐 S1 的“仅分节标题”判定和测试，并在后续迭代处理 S2–S4 的边界与持久化可靠性问题。
