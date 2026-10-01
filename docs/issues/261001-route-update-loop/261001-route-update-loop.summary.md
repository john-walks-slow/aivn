# 路线视图 Maximum update depth exceeded 小结

## 改了什么

`apps/web/src/stage/RouteCanvas.tsx` 一行：布局 `layoutRoute(cards, dir)` 收进 `useMemo`，依赖 `[cards, dir]`。

## 为什么

渲染体里每次重排布局 → `placed` 换身份 → `focusCard` / `jumpToLatest` / `controls` 全跟着换 → `useEffect(() => onControls(controls), [onControls, controls])` 每渲染必重跑 → 外层 `StageScreen` 收一次手柄 `setState` 一次 → 再渲染一圈。闭环成立，浏览器里表现为 `Maximum update depth exceeded` 一路刷。

`controls` 那段注释本来就声明了「对象身份稳定」是这套交接的地基，缺的只是让 `placed` 也稳定。

## 验证

- 控制台 `Maximum update depth exceeded` 条数：修前 24，修后 0（Playwright 探针，进入页面后 6 秒统计）。
- 修后路线照常渲染：1 张卡、卡上背景图在、`.route-scene` 有 transform；点「看全树」transform 变化，镜头操作未被牵连。
- 新增回归测试 `apps/web/test/routeControls.test.tsx` 两例：卡片不变时只交一次手柄（修前 `expected 3 to be 1`，修后过）；卡片变了要再交一次（两边都过，防吞更新）。
- `pnpm typecheck` 三个包过；`pnpm --filter @stage-ai/web test` 9 个文件 64 例过。

## 顺带

为这个测试给 `apps/web` 加了 `jsdom` 与 `@testing-library/react` 两个 devDependency——项目此前只有纯函数测试，这是第一个渲染测试。测试文件用 `// @vitest-environment jsdom` 按文件切换环境，没有改全局 vitest 配置。

## 已知限制

测试只钉第一推动力（effect 该不该重跑），不钉滚雪球本身：照 `StageScreen` 那样在外层 `setState` 会让测试挂死而不是断言失败，读不到差异。滚雪球这一端靠浏览器实测覆盖。
