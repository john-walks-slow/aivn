# 检视报告

## 概要

本轮检视针对角色卡与立绘目录显式绑定（`sprite` 字段）的实现，涉及 `packages/core`、`apps/server` 与 `apps/web` 跨端全链路。整体架构清晰，`spriteIdOf` 作为唯一解析收口规范明确，向后兼容性良好，舞台演出、工坊界面与剧作家提示词均已完成核心对接。

## 需求对齐

本轮改动满足了「角色卡内显式声明立绘归属、缺省同名回落、存量兼容且支持无卡主体」的核心诉求：
1. **角色卡 frontmatter**：在 `CharacterHead` 与 `SCALAR_FIELDS` 白名单中加入了可选的 `sprite` 字段，序列化顺序稳定，空值与首尾空格正确处理。
2. **演出层与资产索引**：`buildAssetIndex` 支持接收 `cast` 并提供 `spriteDirOf` 与 `spriteName`，`StageTheater` 正确将演员 id 解成立绘目录后再寻址素材与呈现三轴。
3. **工坊角色页与素材页**：角色页新增「立绘目录」下拉，缩略图/差分条/管理立绘均走绑定目录；素材页实现按绑定反查角色名及同名换绑时的归属提示。
4. **剧作家系统提示词**：A 区角色表按绑定目录列出差分清单，排除被绑走的目录避免重复列入「无卡主体」，格式规则同步更新。

与完整闭环的细微差异在于：工坊手动出图（`playhouse.requestImage`）与 CG 参考立绘（`playhouse.requestCg`）中，根据立绘目录反查角色人设的逻辑尚未接入绑定反查（详见建议修改）。

## 阻塞问题

无。

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| - | - | 无 | 无 |

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUG-01 | `apps/server/src/playhouse.ts:945, 1032, 1074` | **工坊手动生图/CG参考图未按立绘绑定反查角色卡人设**：在 `requestImage`（sprite 支路）中直接通过 `memory.characters.get(spriteId)` 拿角色卡；若角色卡 `rin` 显式绑定到 `sprite: rinne`，出图时 `spriteId` 为目录名 `rinne`，此处 `get("rinne")` 将得到 `undefined`，导致模型提示词丢失角色人设正文；同理在 `requestCg` 中解析 `refIds`（立绘目录）时亦未通过绑定反查角色名和人设。与 `imageTool.ts` 中「有角色卡时会读卡上的人设来写外观」的契约不一致。 | 在 `playhouse.ts` 内构建目录到角色卡的反查映射（遍历 `memory.characters` 并通过 `spriteIdOf(id, card)` 建立 `dir -> CharacterDocument` 映射），在取 `card` 与 `subjectOf` 时优先走反查映射。 |
| SUG-02 | `apps/web/src/workshop/CharacterPane.tsx:193, 346-352` | **角色页立绘下拉中存在同名选项冗余**：`bindChoices` 取自现存目录 `spriteDirs`，若角色 `mio` 已有同名立绘目录 `assets/sprites/mio/`，则 `bindChoices` 包含 `"mio"`。下拉渲染时既有 `<option value="">与角色同名（mio）</option>`，又有 `<option value="mio">mio</option>`。用户选择两者效果不同（前者清空字段，后者冗余写入 `sprite: mio`），界面语义重复且易产生困惑。 | 从 `bindChoices` 中过滤掉 `dir === activeRole.id`；若角色卡当前显式写了 `activeRole.sprite === activeRole.id`，下拉值可规范化选中空串或自动清洗。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| MIN-01 | `tmp-bind-check.ts:1-23` | **开发期临时验证脚本未清理**：根目录下残留了硬编码本地端口 `http://127.0.0.1:57032/api/plays/test` 的一次性测试脚本，文件注释注有「跑完即删」。 | 在正式提交前将其删除，避免污染提交历史。 |
| MIN-02 | `apps/web/src/app.css:4446-4458` | **窄屏下 `.sprite-bind` 缺少换行保护**：`.sprite-bind` 为行内 flex 布局且未设置 `flex-wrap: wrap`，在宽度小于 400px 的小屏/移动端容器下，「立绘目录」文本、下拉框（`max-width: 240px`）和后面的提示文本可能会产生横向溢出或文本紧贴。 | 为 `.sprite-bind` 增加 `flex-wrap: wrap`，窄屏时提示信息自动折行至下一行。 |
| MIN-03 | `apps/web/src/workshop/AssetsPanel.tsx:173-176` | **已被其他角色认领的目录仍可能展示归属提示**：`orphanNote` 判定条件为 `!card || spriteOwners.get(dir)?.id === dir` 时返回 null。若目录 `rin` 虽被角色 `rin` 放弃，但已被角色 `alt` 显式认领绑定，该目录名片处仍会附带 `｜角色「铃音」的立绘绑的是 ...`，与「这套图现在没人用」的注释描述有轻微语义出入。 | 建议在 `orphanNote` 中判断若当前目录已有其他主人（`spriteOwners.has(dir)`），调整文案或省略 orphan 提示，避免给用户造成「图无人认领」的错觉。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心架构与功能需求满足，存量兼容性与测试覆盖充分，DSL 演出与舞台渲染逻辑闭环；但存在工坊手动生图未按绑定解析人设（SUG-01）及角色页下拉同名项冗余（SUG-02）两项体验与一致性问题，强烈建议在合并前或紧随其后的微调中处理。
