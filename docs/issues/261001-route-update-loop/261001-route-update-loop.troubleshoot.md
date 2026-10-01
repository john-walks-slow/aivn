# 路线视图 Maximum update depth exceeded 排查

**状态：已定位、已修。** 2026-10-01 在 CG 视图收尾时当作「与本次改动无关的既有缺陷」记下，随后用户点名要修。

## 现象

进路线视图，控制台刷 `Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.`

界面本身看不出来：树照常画出来，卡片、背景、两个动词按钮、侧栏镜头工具都在。只是控制台每次渲染都在报，一路刷到 React 的嵌套更新上限（本机实测一次进入刷 12～25 条），CPU 白烧。

## 根因

一条自激的渲染回路，链条全在 `RouteCanvas` 到 `StageScreen` 之间：

1. `RouteCanvas` 的渲染体里直接 `const layout = layoutRoute(cards, dir)`（旧代码在 `RouteCanvas.tsx:68`）。`layoutRoute` 每次都新建 `placed` 数组和其中每个 `PlacedCard` 对象。
2. `focusCard` 的 `useCallback` 依赖 `[placed]`——`placed` 每渲染一次就是新身份，`focusCard` 跟着换。
3. `jumpToLatest` 依赖 `[cards, focusCard]`，`controls` 的 `useMemo` 依赖 `[..., jumpToLatest, ...]`——`controls` 也每次换新对象。
4. `useEffect(() => onControls(controls), [onControls, controls])` 于是**每次渲染都重跑**。
5. 外层 `StageScreen` 收到手柄就 `setRouteControls(c)`（`StageScreen.tsx:98`），存进 state → 再渲染一圈 → 回到第 1 步。

`RouteCanvas` 里那段注释本来就写着「依赖全是稳定引用或原语值，对象身份稳定，外层 setState 拿到同一个对象就不会再触发一轮渲染」——设计意图是对的，只是 `placed` 这条地基没打上。

## 证据

`Maximum update depth exceeded` 的条数，同一套探针（Playwright 开页面，6 秒里数该条 error）：

| 版本 | 条数 |
| --- | --- |
| `35f56b4`（未修） | 24 |
| 修后 | 0 |

修后同时核对了「不是把渲染吞掉了」：`.route-node` 仍然是 1 张卡、`withBg` 1 张带背景、`.route-scene` 有 transform（取景正常），点侧栏「看全树」后 transform 从 `translate(24px, 336.906px)` 变成 `translate(476.406px, 336.906px)`——镜头操作仍然活着。截图见 `route-fixed.png`。

## 修法

```diff
   const dir = pinned ?? auto;
-  const layout = layoutRoute(cards, dir);
+  // 布局必须 memo：placed 的对象身份是下面那条「把手柄交给外层」effect 的地基。
+  // 每次渲染都重排一次 → focusCard/jumpToLatest/controls 全换身份 → effect 重跑
+  // → 外层 setRouteControls 收到新对象再渲染一圈，闭成 Maximum update depth exceeded。
+  const layout = useMemo(() => layoutRoute(cards, dir), [cards, dir]);
   const { placed, edges, width, height } = layout;
```

一行，只把布局收进 `useMemo`，没有动任何渲染结果或交互。`cards` 在外层本来就是 `useMemo` 出来的稳定引用（`StageScreen.tsx:218`），`dir` 是原语，依赖面干净。

## 回归测试

`apps/web/test/routeControls.test.tsx`（新增，跑在 jsdom 下）：画布交出 `controls` 手柄的次数，在卡片没变时必须是 1。

- 未修 → `expected 3 to be 1`（三次渲染交三次）。
- 修后 → 通过。
- 对照组「卡片真的变了才再交一次」两边都过，确保不是把该交的也吞了。

测试里外层**只记账不 setState**：真照着 `StageScreen` 写会重现滚雪球，`render()` 直接不返回、整个文件挂死（本机实测）。挂死的测试没法读断言差异，所以这里只测第一推动力——「什么都没变，effect 该不该再交一次」，那正是回路的开关。

## 顺带记一笔（未处理）

排查时误踩：API 进程收到一个 play id 不存在的 WS 连接就整进程崩（`PlayStore.loadPlay` 的 ENOENT 没人接，`transport.ts:79`）。本机是别的 worktree 的残留客户端连到我这个端口触发的，与本缺陷无关，没有纳入本次改动范围。
