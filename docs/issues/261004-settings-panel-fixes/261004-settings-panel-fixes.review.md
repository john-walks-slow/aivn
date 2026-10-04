# 检视报告

## 概要

本次检视针对 commit `9f76cd3` 修复设置页「保存误清凭据」与「保存/放弃按钮需滚到底」两个缺陷的改动。改动完全收敛在 `apps/web` 呈现层与交互层，准确复用了服务端既有的「掩码回传 = 不改、空串 = 显式清除」契约，并补齐了单测与文档，整体质量良好。

## 需求对齐

- **需求 ①（保存/放弃按钮常驻底部）**：已将保存与放弃操作行从滚动容器 `.settings-body` 剥离至常驻页脚 `.settings-footer`，采用 flex 贴底布局，且同步适配了移动端安全区 `env(safe-area-inset-bottom)`。需求已满足。
- **需求 ②（已配凭据未修改保存时不被误清）**：`draftOf` 直接以读视图中的掩码初始化凭据字段，三个单值凭据输入框改为受控组件并增加聚焦全选交互；未修改时提交掩码，服务端判定不改，修改清空时提交空串触发显式清除。需求已满足。
- **与规范/计划差异**：无遗漏、无过度设计，多把 key（语音/检索）与单值凭据的两套不同语义在文档和代码中保持了清晰边界。

## 阻塞问题

无。

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/web/src/views/SettingsScreen.tsx:242, 347, 480` | **清空凭据时 placeholder 重新显露原掩码造成视觉困惑**：输入框的 `placeholder` 绑定了 `settings.xxx || "未配置"`。当凭据已配好时，其值为掩码（如 `sk-s••••1234`）。当用户按删除键清空输入框（`value=""`）准备清除凭据时，输入框内会立即浮现出灰色的掩码占位符。用户直观上容易误以为“刚刚没删掉”或“内容回弹了”。 | 建议已有凭据时不要将掩码原样作为 placeholder 渲染；可调整为提示性文案（如 `settings.xxxSet ? "留空保存即清除" : "未配置"`），消除清空输入时的视觉歧义。 |
| SUG-02 | `apps/web/src/views/SettingsScreen.tsx:119-131, 631-633` | **「保存设置」缺乏防重复提交态**：`save` 函数为异步请求，但未维护 `saving` 状态，保存按钮未设置 `disabled={saving}`。在高延迟网络下若用户连续点击，可能触发多次重复保存请求。 | 增加 `const [saving, setSaving] = useState(false)` 并在请求执行期间将「保存设置」按钮置为 disabled 态。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| ADV-01 | `apps/web/test/settingsCredentials.test.tsx:94-104` | **单测未覆盖清空访问密码场景**：在第二个测试用例「清空输入框 = 显式清除，保存回传空串」中，仅变更并断言了 `model.apiKey` 和 `image.apiKey`，漏掉了 `password` 的清空断言。 | 在该用例中补充 `fireEvent.change(screen.getByLabelText(/访问密码/), { target: { value: "" } });` 及对应断言 `expect(draft.password).toBe("");`，保证覆盖对称。 |
| ADV-02 | `apps/web/src/views/SettingsScreen.tsx:634-636` | **「放弃改动」触发了额外网络请求**：放弃改动按钮直接绑定了 `onClick={load}`，会重新请求 `api.settings()` 和 `api.agentModels()`。 | 若仅为放弃本地表单输入，可直接重置草稿状态 `setDraft(draftOf(settings))`，避免产生无谓的网络开销与潜在网络报错。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心功能缺陷均已准确修复，前后端契约对齐严密，单测与文档完备；建议对清空凭据时 placeholder 显示掩码导致的交互歧义以及保存防重提交进行轻量优化。
