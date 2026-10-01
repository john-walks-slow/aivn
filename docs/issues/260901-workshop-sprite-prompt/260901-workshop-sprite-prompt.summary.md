# 小结：工坊出立绘这一路

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/playAssets.ts` | 定妆照后缀不再发明人物特征；出图成功后把实际用的 prompt 记进 `assets/generated.json` |
| `apps/server/src/store.ts` | 新增 `PlayLedgerEntry` 与 `ledger()` / `saveLedgerEntry()` |
| `apps/server/src/imageAssets.ts` | 新增 `readPlayLedgerEntries()`（CG 页那一路，与 media-cache 台账并列） |
| `apps/server/src/http.ts` | CG 台账并入剧目内的出图记录 |
| `apps/server/src/prompt.ts` | 立绘差分的两套键约定按字段合并，规范键赢 |
| `apps/server/src/workshop.ts` | 出图章节加四条硬规则（外貌锚点 / neutral≠normal / 逐条核对 / 失败原文）；描述表补「定点改 + 别拿别的条目当锚点 + 台账只读」 |
| `apps/web/src/workshop/AssetsPanel.tsx` | 素材行描述多一次裸键回落（与服务端同一条规则） |
| `README.md` / `AGENTS.md` | 出图记录文件、CG 台账的 prompt 来源、两套键约定 |

## 实测结论

一轮实跑里，模型听话但提示词没说清：外貌锚点不写进 prompt 就出不来卡上那个人；自查没有清单就会点头式汇报；
失败不说原文用户就判断不了是谁的问题。引擎侧两个真问题——后缀写死发型、prompt 不留痕——都已修。
留痕方案在实跑中被自己的第一版推翻过一次（同一张表两个写者），最终落到引擎独占的 `assets/generated.json`。