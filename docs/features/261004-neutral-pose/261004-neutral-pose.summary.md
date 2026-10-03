# 定妆照不再写死姿势

## 背景

定妆照（`neutral`）是所有差分的垫图基准：差分恒以它为身份基准、且只改表情，所以**定妆照的姿势就是这个角色的终身姿势**。而引擎的两段自动后缀把姿势写死了：

- `NEUTRAL_LEAD` 前置：`a calm neutral-expression front-facing standing portrait.`
- `POSE_TAIL` 追加：`front-facing standing pose, ... both arms held slightly away from the body ...`

两段一前一后夹住调用方的 prompt，压掉它写的任何姿势；而 `imageTool.ts` 的 `PROMPT_RULES` 本来就要求「姿势、机位、景别都要显式写」。结果是每个角色、每张定妆照都是同一个正面对称站桩，定妆照当不了「能表达角色气质的基本立绘」。

## 改动

- `NEUTRAL_LEAD` 只留表情与气质：`a calm neutral-expression portrait of the character, in a natural pose that expresses their personality.`（half 加 `waist up`，square 不变）
- `POSE_TAIL` 不再规定站姿，只留抠底真要的那条 + 舞台要的头顶留白。
- 顺手删掉 `COMMON_TAIL` 上方那段已被第二段取代的孤儿注释。

## 抠底的约束清单（再改后缀时不要动的部分）

`cutout.ts` 的全局色键 + 滞后阈值 + 连通域筛背景，真正需要的只有四条：

1. 2D 平涂 + 纯白纯色底——3D 渲染的白衣离底色只有几格色差，会被连人带和服一起啃掉；
2. 主体完整入画、不出框——第 5 步要裁外框、等比缩放、底部居中放进 9:16 画布；
3. 头顶留白——舞台按统一锚点摆位（`.theater-sprite`）；
4. 手臂与躯干之间不留窄白缝——窄缝面积小于 `minHole`，会被当成眼白那样的高光填回前景，剪影里多一块白。

「正面站姿」不属于其中任何一条：它是标准立ち絵的惯例（便于并排、便于差分、便于对着观众说话），代价是所有角色共用一个姿势。姿势交给调用方，站姿/坐姿/机位由角色气质决定。

## 验证

`pnpm -r build` + `pnpm --filter @stage-ai/server test` → 471 passed / 3 skipped。

`playAssets.test.ts` 里三条钉住旧措辞的断言改为钉新契约：引擎不覆盖调用方的姿势、窄缝约束仍在、`neutral-expression` 前置描述仍在。未真机出图验收（用户明确要求跳过）。
