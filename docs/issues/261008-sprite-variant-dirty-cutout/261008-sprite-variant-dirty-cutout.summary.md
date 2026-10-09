# 立绘差分被抠成镂空 —— 修复小结

## 交付内容

| commit | 内容 |
| --- | --- |
| `7b93c607` | 根因诊断（现象、量化复现、坏味道、修复路径） |
| `010ddabf` | 修正底色归属的取证方式，补「坏味道」一章 |
| `16e9e055` | 代码修复：提示词出口归一、垫图换原片、抠底加底色体检 |

诊断全文见 [`261008-sprite-variant-dirty-cutout.troubleshoot.md`](./261008-sprite-variant-dirty-cutout.troubleshoot.md)。

## 根因回顾

**不是重复抠图。** 逐张比对成品 alpha 与「能复现它的那份源图重跑一遍抠底」的结果，
全部吻合到 0.2% 以内；而重复抠图的量级（对已抠好的透明 PNG 再抠一遍，alpha 差异 1.06%）
与观察到的成片镂空（24%~55%）差两个数量级。

真因：**差分出图时的底色跑成了白底/灰底**，而 `cutout.ts` 是全局纯色键
（离底色 ≤ tolerance 的像素一律判背景，不看连通性），白底会把角色身上一切接近白的像素
（白袜、白衬衫、银发）判成背景，整张立绘被打穿。

按「能复现成品的源图」定底色，统计相关非常干净：

| 能复现成品的源图底色 | 张数 | 平均内部空洞率 |
| --- | --- | --- |
| 绿幕 / 品红（设计值） | 67 | **1.8%** |
| 白底 / 灰底 | 33 | **20.1%** |

### 实现层的坏味道

同一条不变量（立绘底必须是单一色键色）在 `playAssets.ts` 里**写了两遍**：
定妆照走 `COMMON_TAIL` → `KEY_BACKGROUND`（点名纯绿/纯品红），
差分走手写的第二份 `IDENTITY_TAIL`（只说「跟参考图同色」）。
2026-10-04 的绿幕改造（`a7809fe3`）只改了前者，差分这份被漏掉。
**重复本身不是问题，重复 + 只改一份才是。**

另外两处同源毛病：`KEY_BACKGROUND` 与 `IDENTITY_TAIL` 各自抄了一遍「不加渐变/影/字」的尾句
（还只对上了三个词）；片段靠手拼标点，`humanSuffix` 用 `+`、调用方再补 `.`，
出过 `one arm.. Same character` 这种双句点——实测 **30/57 条**差分 prompt 带着 `..`。

## 修复

### 1. 提示词后缀收成唯一出口（`playAssets.ts`）

`spriteSuffix(framing, variant, sentReferences)` 是立绘后缀的唯一出口：定妆照与差分拼
**同一个片段序列**，差别只在「身份」那一段。底色 / 画风 / 不留杂物几条从此
**不可能只在一条分支上生效**。删掉 `COMMON_TAIL`、`humanSuffix`、`neutralSuffix`、
`IDENTITY_TAIL`、`identitySuffix` 这一整套双出口结构，`KEY_BACKGROUND`、`STYLE`、
`NO_ARTIFACTS` 各只剩一份。

标点也收口：片段自带的尾句点统一削掉再 `join(". ")`。

### 2. 差分垫图改用带色键底的原片（`playAssets.ts`）

差分的垫图原先恒为 `assets/sprites/<id>/neutral.png`——一张**已经抠过底的透明 PNG**。
透明像素没有颜色，模型自行还原成白底，恰好落进上一条的坑里。

`neutralReferenceOf()` 改为优先用 `media-cache/sprite-sources/<id>/neutral.jpg`（带色键底）。
**不能无条件换**：用户自己导入的立绘（`assetImport.ts`）直接落 `assets/sprites/`、不留原片，
那种主体只有抠好的 PNG 可垫，退回它。

`spriteSourcePath()` 相应从「读当前 spec 的 stem」改成 `(spriteId, stem)`——差分垫图必须传
`NEUTRAL`，拿差分自己的原片当基准是换脸。

### 3. 抠底加底色体检（`cutout.ts`）

`assertKeyBackground()` 在抠底最前面取整圈边框逐通道中位数，算通道极差，`< 96` 直接抛错。
判据是「通道极差」而不是「白不白」：合法色键色必然三通道差得极开，白/灰底 ≈ 0。

这是本 bug 唯一能兜住的防线——此前这种图会一路静默入库，只有用户肉眼看得出来。

## 验证

### 闸门有效性（拿历史上真实源图跑）

| 源图 | 旧行为 | 新行为 |
| --- | --- | --- |
| `testtest/lilia/surprised`（白底） | 静默落一张打穿图 | **REJECT**（极差 0） |
| `testtest/sayo/surprised`（白底） | 静默落一张打穿图 | **REJECT**（极差 0） |
| `testtest/kanon/smile`（白底） | 静默落一张打穿图 | **REJECT**（极差 0） |
| `testtest/lilia/smile`（灰底） | 静默落一张打穿图 | **REJECT**（极差 0） |
| `testtest/lilia/neutral`（绿幕） | 干净 | PASS（coverage 0.210） |
| `testtest/kanon/neutral`（品红） | 干净 | PASS（coverage 0.230） |
| `mh/rin/laugh`（绿幕） | 干净 | PASS（coverage 0.269） |

全量扫过盘上 60 份源图：**16 份色键底全部通过，44 份非色键底全部拦下**，无误伤。

### 自动化测试

| 套件 | 结果 |
| --- | --- |
| `typecheck`（全 workspace） | 通过 |
| `pnpm -r build` | 通过 |
| `test/cutout.test.ts` | 15/15（含 2 条新增体检用例） |
| `test/playAssets.test.ts` | 52/52（含 3 条新增回归用例） |
| `test/agentkit.test.ts` + `test/workshop.test.ts` | 78/78 |
| `test/image.test.ts` + `test/playhouse.test.ts` | 29/29 |
| server 全量 | 732 passed / 4 failed |

那 4 例失败在 `test/voice.test.ts`（语音管线），已用 `git stash` 在**改动前的干净树**上复现，
与本次无关。

### 新增的回归用例

- 定妆照与差分**都**断言含色键底要求，且不得再出现 `same single flat solid background colour`。
- 片段拼接不产生 `..`。
- 差分垫图来源：有原片用原片（且断言不是透明 PNG），无原片退回 PNG。
- 白底/灰底被体检拦下；纯绿与纯品红不被误伤。

## 副作用

- **白底/灰底源图现在直接报错**，不再产出半残图。这是本意：这类图本来就该在出图那一步修。
- 差分垫图从 PNG 变 JPEG，模型侧看到的参考图带上了底色。
- 存量已打穿的成品**不必重画画面**：留底原片还在，重出差分即可。注意 `recut_sprite` 救不了
  白底源图（它仍是纯色键，白底照样打穿）——那种只能重新出图。

## 未覆盖 / 待观察

- 差分为何会把透明垫图还原成白底，是模型内部行为，无法直接观测；修复走的是
  「不依赖该行为」的路子（明确要求色键底 + 垫图换成带底原片），
  所以即便成因判断有偏差，修复方向仍然成立。
- 体检阈值 96 是按现有样本定的（合法底色实测极差 191~255）。若将来出现偏暗但仍合法的
  色键底（极差 96~191 之间），需要按实测重新评估。
