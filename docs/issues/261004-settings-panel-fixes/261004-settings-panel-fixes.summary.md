# 设置页：保存误清凭据 + 保存按钮要滚到底 小结

## 背景

用户两条反馈：

- 「全局设置，保存和放弃应该始终在底下而不是需要滚动下去才看到」
- 「密钥没填和隐藏两个状态现在是不是混淆了？我settings里已经配置过，然后设置里在点保存，结果把我的key都覆盖成空的了」

## 结论

两个问题都出在 `apps/web`，服务端零改动。

凭据被清是客户端把「没填」和「不想改」混成了同一个空串：`draftOf` 一律用空串初始化
`apiKey` / `image.apiKey` / `password`，其中 model、image 两个输入框还是非受控的
（掩码只摆在 placeholder）。服务端的契约恰好相反——**回传掩码 = 不改，回传空串 = 显式清除**，
于是打开页面什么都不做、点一次保存，三处凭据就被当成「用户要删」执行了。

按钮要滚到底是因为「保存 / 放弃」那一行是滚动容器 `.settings-body` 的最后一个子元素。

## 改动

- `apps/web/src/views/SettingsScreen.tsx`：`draftOf` 把读视图里的掩码当草稿初值回填；
  三个单值凭据输入框改受控并聚焦全选；保存 / 放弃那一行移出滚动区，成为常驻页脚。
- `apps/web/src/app.css`：新增 `.settings-footer`；`.settings-body` 底部内边距收紧；
  移动端安全区 `padding-bottom` 从 body 挪到 footer。
- `apps/web/src/api.ts`、`README.md`、`apps/web/AGENTS.md`：把「输入框留空 = 不改」的旧说法
  改成单值凭据「掩码原样回传 = 不改、清空 = 清除」，多把 key（语音 / 检索）另记一套语义。
- 新增 `apps/web/test/settingsCredentials.test.tsx`：两个用例，锁住两种回传语义。

多把 key（语音 / 检索）语义没动：输入框恒空、留空 = 不改、填入 = 整组替换。

## 验证

- `pnpm --filter @aivn/web typecheck` 通过；
  `pnpm --filter @aivn/web test settingsCredentials.test.tsx` 两个用例通过。
- 用户实机验证项见同目录 `261004-settings-panel-fixes.validation.md`，主路径是
  「刷新后什么都不改点保存，两把 key 不该消失」。

## 善后

用户点保存时被清掉的两把 key（模型网关、生图）已从 `.env` 的迁移原值写回 `settings.json`，
服务端即时重载后 `apiKeySet` / 生图 `apiKeySet` 均为 true，模型网关实测 HTTP 200。
语音 3 把、检索 4 把当时未受影响。

## 后续别踩

见排障记录 `261004-settings-panel-fixes.troubleshoot.md` 的「关键约束」一节：
单值凭据输入框的初值必须是掩码，多把 key 与单值凭据是两套语义。
