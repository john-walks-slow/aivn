# stage-ai MVP 用户验证（P0：语言与契约层）

## 验证说明

- 验证对象：P0 交付——pnpm monorepo 脚手架 + `@stage-ai/core` 包（DSL v1 冻结规范、流式解析器、IR/WS 协议类型、谱系数据模型）
- 环境/前置条件：Node ≥ 22.19、pnpm 11；在仓库根目录执行
- 说明：P0 是纯库层（无 UI、无运行时服务），核心正确性已由 45 个自动化用例覆盖（含 P0 验收标准三要素：残缺流撕裂、消息边界自动闭合、stop 后事件丢弃）。用户验证聚焦"环境可复跑"与两轮检视结论的抽查确认。

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| `pnpm install && pnpm test` | 2 个测试文件、45 个用例全部通过（解析器 golden + 谱系模型） | | 待验证 | |
| `pnpm typecheck && pnpm build` | 零错误，`packages/core/dist` 产出 | | 待验证 | |
| 抽查撕裂容错：`packages/core/test/parser.golden.test.ts` 中 `chunk=1/2/3/5/7 撕裂喂入与整段喂入语义等价` 5 个用例 | 全绿——流式 token 任意位置撕裂不影响语义事件序列 | | 待验证 | P0 验收核心 |
| 阅读 `docs/features/260928-stage-ai-mvp/260928-stage-ai-mvp.review-round2.md` 结论 | 第二轮检视"通过（代码层）"，B1/B2 阻塞项实证修复 | | 待验证 | |

## 验证结论

待验证。

## 待跟进

无。
