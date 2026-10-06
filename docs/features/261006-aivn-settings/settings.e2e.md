# dsh-aivn 插件设置面端到端测试报告

## 测试环境
- **测试实例**：E2E DSH Web GUI 实例（`http://127.0.0.1:30938/?token=e2etest`）
- **DSH Home 路径**：`/root/projects/dsh-aivn/.dsh-e2e-home`
- **配置文件路径**：`.dsh-e2e-home/profiles/web/cordis.patch.yml`
- **会话日志路径**：`.dsh-e2e-home/sessions/--root-projects-dsh-aivn--/<session-id>/session.v4.jsonl.zstd`
- **工作区**：`/root/projects/dsh-aivn`（分支 `master`）

---

## 功能类测试项

| # | 测试步骤 | 预期 | 实际 | 状态 | 证据 |
|---|----------|------|------|------|------|
| 1 | 打开侧边栏 Plugins → Installed → 找到 dsh-aivn 并点击详情卡 | 成功展示配置卡；P0/P1 两段分组与说明文字清晰；`ttsKeys` / `searchKeys` / `imageApiKey` / `musicApiKey` 4个密钥字段显示「未配置」徽标 | 配置卡卡片正常渲染，17 个扁平配置项展示完整，4 个密钥字段初始均报「未配置」，且数组密钥未被空数组假冒已配置 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/01-settings-accessibility.png` |
| 2 | 在 `ttsKeys` 中填入假 Key `e2e-fake-fish-key-0123456789` 保存，不重启实例新建搭台助手会话跑一轮；随后点击「清除已存 Key」并再次新建会话 | 填 Key 后新会话工具面出现 `list_voices`、系统提示词有音色章；清除后新建会话工具面移除 `list_voices`，运行期面就地重建 | 会话日志帧断言：填 Key 后的搭台助手会话（`session-d495c2b5-...`）具备 `list_voices` 工具并注入音色章；点击清除后新建会话（`session-7365d538-...`）工具集中无 `list_voices` | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/02-fishkey-saved.png` |
| 3 | 配置 `imageBaseUrl = http://127.0.0.1:1` 与 `imageModel = fake-model` 并保存，分别新建搭台助手与剧作家会话跑一轮 | 搭台助手出现 `generate_image` / `commit_asset` / `recut_sprite`；剧作家出现同步出图的 `generate_image` | 会话日志帧断言：搭台助手会话（`session-92ed434b-...`）包含草稿出图与抠底全套工具，剧作家会话（`session-c5186166-...`）同步包含 `generate_image` 工具 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/03-image-configured.png` |
| 4 | 在 `shell` 开关关闭时新建会话 A；在配置卡打开 `shell` 并保存；之后新建会话 B；对比两会话工具集及 README/Hint 描述 | 旧会话 A 无 `bash` 工具；新建会话 B 出现 `bash` 工具；界面 Hint 和 README 均明确注明“只对新建的搭台助手会话生效” | 日志帧断言：旧会话 A 无 bash，新会话 B（`session-7fdb8c16-...`）工具集出现 `bash` 工具；界面开关 Hint 及 README 第 82/94 行明确写明限制 | 通过 | `/root/projects/dsh-aivn/e2e-artifacts/04-shell-hint.png` |

---

## 体验类测试项

| # | 体验场景 | 关注点 | 观察 | 建议/问题 |
|---|----------|--------|------|-----------|
| 1 | 配置卡视觉与分组设计 | P0/P1 分组结构、Hint 提示直观性与顶部状态灯 | 整体分为“P0·能力开关”与“P1·默认就能用”两段，布局层次鲜明；顶部包含动态状态灯（显示生图、检索、命令行等开闭状态），信息量充足且一眼能看懂能力边界 | 建议：顶部状态灯后“（按当前配置算；环境变量里的 Key 不在这里显示）”可以维持轻量样式，避免干扰主标题 |
| 2 | 密钥安全防护与“只写不回显” | 敏感凭据安全性、刷新脱敏、清除交互 | 输入 Key 保存后，界面及同源 `/aivn/settings` 网络响应中均不返回明文 Key，徽标显示“已配置”；配置卡中额外提供红字“清除已存 Key”按钮，可一键 unset 回“未配置”，对用户心理感知极其安全放心 | 体验好，符合零泄露安全防护铁律 |
| 3 | 规则与降级口径的交互引导 | 能否准确理解配置规则与就地生效范围 | “地址与模型都给齐才算配好生图”以及命令行（bash）“只对新建搭台助手会话生效”的提示文案，分别直观呈现在对应输入框下方，防止用户因误以为修改立刻影响旧会话而产生困惑 | 体验良好，文案表达准确到位 |
| 4 | 响应式布局与窄窗口适配 | 屏幕缩放或移动端/窄窗口排版表现 | 在 1280px 标准宽屏与 375px 移动端/窄窗口下观察，表单网格自动切换为单列排版，保存/恢复按钮始终锚定顶部/底部，没有发生控件重叠、溢出或横向滚动条 | 响应式适配完成度高 |

---

## 证据图

![界面可达性及初始状态](</root/projects/dsh-aivn/e2e-artifacts/01-settings-accessibility.png>)

![填入 Fish Key 保存](</root/projects/dsh-aivn/e2e-artifacts/02-fishkey-saved.png>)

![配置生图后端与状态灯亮起](</root/projects/dsh-aivn/e2e-artifacts/03-image-configured.png>)

![命令行 (bash) 开关与提示 Hint](</root/projects/dsh-aivn/e2e-artifacts/04-shell-hint.png>)

![配置卡标准宽屏视图](</root/projects/dsh-aivn/e2e-artifacts/05-settings-card-wide.png>)

![配置卡窄屏 (375px) 视图](</root/projects/dsh-aivn/e2e-artifacts/05-settings-card-narrow.png>)

---

## 结论
- **功能测试**：通过 4 · 不通过 0 · 受阻 0
- **体验测试**：4 项主观体验观察，关键问题 0
- **总体结论**：**通过**（建议交付）

---

## 待跟进
- 无阻塞性缺陷或体验待跟进项。配置改动落盘、就地生效、密钥脱敏与 UI 渲染表现均符合预期。
