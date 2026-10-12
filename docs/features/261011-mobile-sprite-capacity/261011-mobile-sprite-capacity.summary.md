# 窄屏立绘容量：实施总结

日期：2026-10-11

## 结果

舞台新增 presentation planner：服务端与 `VisualState` 保留完整在场状态，舞台端按容器宽度选择容量档并决定当前画面显示哪些角色。

- 窄竖屏（容器宽度 < 480px）容量 2。
- 较宽竖屏容量 3。
- 横屏/桌面不收起角色，沿用原有排布。
- 保留顺序：当前说话人 > `keep_visible` > 新入场角色 > 旧入场角色。
- `keep_visible` 超过容量时仍保留；普通角色才会被暂时收起。
- 收起只影响渲染，不触发 actor leave，不修改 `VisualState`、`orderSeq`、`actionSeq`。
- DSL 属性为 `keep_visible="true"`，内部类型为 `keepVisible`。

## 验证

- core parser 相关用例：3 条通过。
- stage actor 状态与 planner：27 条通过。
- workspace typecheck：core、agent、stage、server、web 全部通过。
- core parser 3 条、stage actor/planner 27 条通过；reviewer 准入，0 阻塞。
- 390×844 实拍：三人同框收敛为两人，当前画面可读；证据见 `docs/screenshots/metrics-ab/capacity-after-mobile.png`。
- reviewer 的 ResizeObserver 目标、回放字段与显式站位映射建议已处理；visibility 过渡暂按第一版简单方案保留。

## 边界

第一版没有连续缩放、作者 priority、自动替换、头像提示和 resize hysteresis。桌面不做容量裁剪；跨宿主验证在合并主线后执行。
