# 检视报告

## 概要

本次对 `feat/asset-library` 分支的「素材资源库」功能进行了全面代码检视。该功能架构设计清晰：坚持本地只读扫描、跨剧目复制导入以确保剧目自包含与可导出性、元数据贯通到 A 区提示词以驱动剧作家选曲、前端采用双通道循环音频并收敛了「缺省保持、`none` 停止」的音频调度逻辑。整体实现度高，绝大多数模块严格遵循了项目铁律。

但在谱系事件重放、音轨停止语义一致性以及 `play.json` 并发安全与工坊撤销规范方面，存在 3 项必须修复的阻塞问题。

## 需求对齐

| 需求项 | 计划要求 | 实现情况 | 对齐结论 |
| --- | --- | --- | --- |
| 跨剧目本地素材库 | 扫描本地目录、元数据 schema、搜索过滤、只读不写 | `AssetLibrary` 纯只读扫描，支持 metadata 与 warnings | ✅ 满足 |
| 资源库导入剧目 | 复制非引用、写 manifest、合并角色卡、保存即生效 reload | `assetImport.ts` 实现复制与合并，REST/工坊均接入 | ⚠️ 存在并发覆盖与撤销丢失问题 |
| 预置种子素材 | 常用背景/立绘/BGM/SFX 预置，许可清晰 | 预置 66 条素材，含调研报告与 meta.json | ✅ 满足 |
| 工坊 agent 浏览与导入 | 增加 `list_library` 与 `import_asset` 工具，支持对话流内联展示 | 实现了 2 个工具并在 prompt 补充指引，音频可就地播放 | ✅ 满足 |
| 音频机制补完 | BGM 缺省续播、ambient 常驻底音、交叉淡入淡出、音量控制 | `loopAudio.ts` 实现双通道与淡入淡出，DSL 增加属性白名单 | ⚠️ 谱系重放与空串停止语义存在一致性缺陷 |

---

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| BLOCKER-01 | [replay.ts:102, 204-216](packages/core/src/lineage/replay.ts#L102) | **`lineage/replay.ts` 声明了 `pickVolume` 但未在 `scene` 重放中调用，重放时音量完全丢失**。<br>在 `replay.ts` 中新增了 `pickVolume` 辅助函数，但在 `switch (node.kind)` 的 `case "scene"` 分支里仅执行了 `...pickDefined(attrs, ["bg", "bgm", "ambient", "transition"])`，未合并 `pickVolume(attrs, ["bgm_volume", "ambient_volume"])`。当用户在舞台中执行**跳转（jump）**、**分岔（fork）**、**重写**或**重连恢复**时，谱系重放还原出的 `scene` 事件中将完全丢失 `bgm_volume` 和 `ambient_volume`。 | 在 `packages/core/src/lineage/replay.ts:102` 中，将 `scene` 的 push 逻辑修改为同时合并 `pickVolume`：<br>`push(base, { kind: "scene", ...pickDefined(attrs, ["bg", "bgm", "ambient", "transition"]), ...pickVolume(attrs, ["bgm_volume", "ambient_volume"]) });`，并补充相应的单元测试。 |
| BLOCKER-02 | [orchestrator.ts:1210](apps/server/src/orchestrator.ts#L1210) | **编排器写入谱系时剔除空串属性，导致 `bgm=""`/`ambient=""` 停止语义在重放时退化为「保持当前」，引发流式与重放状态严重不一致**。<br>根据计划与规范约定，音频属性缺省为保持当前，显式 `none` 或空串 `""` 为停止。然而 `orchestrator.ts:1210` 执行了 `for (const key of Object.keys(attrs)) if (attrs[key] === "") delete attrs[key];`。当模型输出 `<scene bgm=""/>` 时，实时流解析将其判定为停止（实时听感已停）；但进谱系时 `bgm` 属性被整项删除，导致谱系节点中无 `bgm` 键。重放时该属性变为 `undefined`，被 `resolveAudio` 解释为「保持当前」（继续播放原音乐）。用户分岔、跳转或刷新后音乐重新响起，流式演出与重放状态矛盾。 | 在写入谱系前，先将 `bgm` 和 `ambient` 的空串（或空白串）统一归一化为标准的 `"none"` 停止标记，然后再过滤其他非音频字段的空串；或者在 `attrs` 中明确保留能够表达停止的标记，确保重放时能还原出显式停止事件，而不会与未指定的 `undefined`（保持当前）混淆。 |
| BLOCKER-03 | [assetImport.ts:155-174](apps/server/src/assetImport.ts#L155-L174)<br>[workshop.ts:422](apps/server/src/workshop.ts#L422) | **立绘包导入绕过 `play.json` 串行写队列，存在并发覆盖风险；且工坊导入时未触发 `workshop_write`，破坏「可见可撤销」铁律**。<br>1. **并发破坏**：`AGENTS.md` 明确规定 `play.json` 补写必须走串行队列（`workshopAssets.ts:266` 的 `playJsonWrites`），防止并发任务同时读取旧 `play.json` 导致后写覆盖先写。`importSpritePack` 直接通过 `store.loadPlay()` / `store.savePlay()` 写入 `play.json`，若用户/agent 连续触发两次导入，或出图与导入交织，会发生角色卡及差分静默丢失。<br>2. **铁律违背**：工坊规则要求写盘必须「可见可撤销（`workshop_write` 带 `before`）」。`import_asset` 工具虽然触发了 `onAsset`，但对 `assets/manifest.json` 和 `play.json` 的修改未调用 `onWrite` 广播，导致工坊前端没有撤销条，用户无法撤回导入造成的剧目配置变更。 | 1. 抽取或复用 `play.json` 的串行更新队列，确保立绘导入在修改 `play.json` 时与工坊其他写操作串行执行。<br>2. 在工坊 agent 调用 `import_asset`（或在 `assetImport.ts` 支持回调）时，对修改的 `play.json` 和 `assets/manifest.json` 触发 `deps.onWrite`，广播 `workshop_write` 事件以支持工坊一键撤销。 |

---

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| SUGGEST-01 | [loopAudio.ts:62-78](apps/web/src/stage/loopAudio.ts#L62-L78) | **`LoopChannel.retire()` 连续快速换曲时掐音对象反转，误将新退场曲掐掉而保留最老淡出曲**。<br>在 `retire()` 中，当 `!this.retired` 为 false（即前一首还在 1200ms 的淡出期内）时，代码执行了 `this.cancelRamp(old); old.pause(); ...`。这里的 `old` 是刚被换下的曲目，而不是正在淡出的 `this.retired`。其后果是：如果在淡出尚未完成时再次换曲，本应淡出的新曲目被瞬间硬掐静音，而最早的曲目仍在淡出中。 | 若已有 `this.retired` 在淡出，应先硬掐并清理已在淡出的 `this.retired`，然后将当前的 `old` 设为 `this.retired` 并对其执行 `rampTo(old, 0)`。 |
| SUGGEST-02 | [StageTheater.tsx:233](apps/web/src/stage/StageTheater.tsx#L233) | **环境音硬编码只查 `sfx` 目录，导致放置在 `bgm/` 下的循环环境音频无法播放**。<br>`const ambientUrl = index.sfx(visual.ambient);` 仅在 `assets/sfx/` 中寻址。但种子库中预置了如 `bgm_forest_ambience`、`bgm_rainy_night` 等带有循环属性的环境背景音（存放在 `library/bgm/`）。若导入为 BGM 类别并在场景中引用为 `ambient="bgm_forest_ambience"`，会导致寻址为 null 产生意外静音。 | 在 `StageTheater.tsx` 中将 ambientUrl 的解析拓宽为优先从 sfx 查找、未命中则从 bgm 查找：`const ambientUrl = index.sfx(visual.ambient) ?? index.bgm(visual.ambient);`；或者在 `buildAssetIndex` 中显式收敛 `ambient` 解析方法。 |
| SUGGEST-03 | [orchestrator.ts:1226](apps/server/src/orchestrator.ts#L1226)<br>[replay.ts:115](packages/core/src/lineage/replay.ts#L115) | **`sfx` 事件入谱系及重放时丢失 `volume` 属性**。<br>`parser.ts` 已经支持 `<sfx src="..." volume="0.5"/>`，但在 `orchestrator.ts` 中 `appendLineage("sfx", { payload: { seq, attrs: { src: event.src } } })` 漏掉了 `volume`，且 `replay.ts` 重放时也只取了 `src`。在打字机历史回放或分岔重放时，音效的自定义音量会回退为默认的 0.7。 | 在 `orchestrator.ts` 中将 `event.volume` 记录进 `attrs.volume`（若存在），并在 `replay.ts` 的 `case "sfx"` 中解析回数字填入 `StageEvent`。 |
| SUGGEST-04 | [http.ts:134](apps/server/src/http.ts#L134) | **资源库静态文件路由未严格校验路径段总长度**。<br>`if (parts[0] === "library" && method === "GET")` 仅解构了前 4 个段 `const [, kind, id, file] = parts;`，未校验 `parts.length === 4`。若请求 `/library/backgrounds/bg_01/foo.jpg/extra`，多余段会被忽略并依然返回 `foo.jpg`。 | 增加 `parts.length === 4` 的路径长度校验，避免非规范路径命中静态服务。 |

---

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| INFO-01 | [LibraryBrowser.tsx:94-98, 123](apps/web/src/workshop/LibraryBrowser.tsx#L94-L98) | **分类 Tab 数量徽标在切换分类后失效**。<br>`counts` 是根据当前拉取到的 `entries` 动态计算的。当用户选中某个类别（如「背景」）后，服务端只返回背景条目，导致其他 Tab 的条目计数被清空。 | 若需要展示各分类全局数量，可在全量加载时保存一份分类汇总，或由服务端 `/api/library` 接口返回各 kind 的聚合总数。 |
| INFO-02 | [library.ts:56](apps/server/src/library.ts#L56) | **`mediaFiles` 使用 `entry.isFile()` 会过滤掉符号链接（symlink）**。<br>部分开发者或高级用户习惯使用软链接将外部已有的大容量音视频目录链接到 `library/` 下。`entry.isFile()` 对符号链接返回 false。 | 虽符合当前无 symlink 的简明原则，但若未来支持软链，可改用 `entry.isFile() || entry.isSymbolicLink()` 并辅以 `stat` 验证真实文件。 |
| INFO-03 | [test/](apps/server/test/assetLibrary.test.ts) | **缺少谱系重放阶段的音频属性端到端单元测试**。<br>现有测试重点覆盖了解析器（`assets.test.ts`）与资源库扫描（`assetLibrary.test.ts`），缺少针对 `orchestrator.appendLineage` -> `replayEvents` 全链路中 `bgm_volume`、`ambient_volume`、`bgm="none"` 的回归测试。 | 在 `packages/core/test/` 或 `apps/server/test/` 中补齐谱系音频重放的 golden 测试。 |

---

## 准入结论

**结论**：`不准入`

**说明**：存在 3 项阻塞问题：
1. `lineage/replay.ts` 漏接 `pickVolume`，导致重放/分岔/跳转时 `bgm_volume` 与 `ambient_volume` 丢失；
2. `orchestrator.ts` 剔除空串导致 `bgm=""`/`ambient=""` 停止语义在谱系重放时退化为保持播放，引起实时演出与重放状态不一致；
3. `assetImport.ts` 未接入 `play.json` 串行写锁存在并发数据丢失风险，且工坊导入缺少 `workshop_write` 撤销条违背铁律。

须修复以上 3 项阻塞问题并补齐相应测试后重新检视。
