# stage-ai P5 用户验证

## 验证对象

①剧目文件清单里没有、但剧情需要的背景/插图，剧作家会用 `<preload_asset>` 提前几拍自己画；②图在途时舞台上是骨架占位、**台词照常演出**，图到货后淡入替换；③同一张描述只生成一次，产物落 `media-cache/img/`；④生图失败/超时不打断演出，舞台保持降级视觉并给可点掉的提示；⑤重连后已生成的图立即可见。

## 机器侧已预验

- 单测 core 65 + server 77 全绿。含：内容寻址缓存命中不重复调用网关、同描述不同 id 共用一张文件、同 id 并发去重、失败向上抛且不留 manifest 记录、manifest 指向的文件被删后不认账（磁盘是权威）、两种网关协议解析（`images/generations` 的 base64 与远端 url、SSE 流里的 `delta.images`）、网关报错带出状态与响应体、编排器 bg/cg 触发预发射而 sprite 不发
- 端到端（起假 cpa 网关：SSE 演剧本 + 假图接口）：DSL `preload_asset` → 生成落盘 → `asset_ready` → 客户端预解码 → 舞台挂上 `<img class="theater-bg theater-bg-in">` 且 URL 正确；浏览器内轮询观测到 `fallback → SKELETON(持续 5.3s) → READY` 的骨架占位到货替换全过程；重连 hello 带回 manifest 全集；静态路由 200、`../play.json` 穿越 404、缺失文件 404

## 前置

- `.env` 里配好能出图的网关：`STAGE_BASE_URL`（cpa）、`STAGE_API_KEY`、`STAGE_IMAGE_MODEL`、`STAGE_IMAGE_SIZE`
- 想知道默认模型能不能直接用，先手动打一发：

```bash
curl -s -X POST "$STAGE_BASE_URL/images/generations" \
  -H "Authorization: Bearer $STAGE_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"anime visual novel background, school gate under cherry blossoms, no text","size":"1536x1024","n":1}' | head -c 300
```

- 想在真机验证前先看效果，可把 `STAGE_IMAGE_MODEL` 换成一个**确定能出图**的模型再试。**换 seedream-5.0-lite 时 `STAGE_IMAGE_SIZE` 必须 ≥3686400 像素**（如 `2560x1440`），否则 400
- 建议用一个背景不多、剧情能走出新场景的剧目（demo 已有 8 张背景，剧作家可能全程不生图）

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 打开一个新场景，看 server 日志是否出现生图请求（`STAGE_IMAGE_MODEL` 那个接口） | 剧本里出现 `<preload_asset>`，且它在引用该 id 的 `<scene>`/`<cg>` **之前 3–5 句**出现 | | 待验证 | 提示词已写死这条规则；提前太多图会白生 |
| 图还在生成时点舞台推进到引用该资产的那一拍 | 舞台上出现**骨架占位**（暗色微光流动），**台词正常演出不被卡住**，顶栏场景名显示该资产 id | | 待验证 | 骨架禁止永久停留：15–30s 内必被替换 |
| 图到货后 | 骨架在约半秒内淡入成真正的图，背景/插图与 id 对得上 | | 待验证 | crossfade 替换，不需要刷新 |
| 生成完成后看 `plays/<id>/media-cache/img/` | 有一张 `*.jpg` 和一个 `manifest.json`，manifest 里是 `id → 文件` 的映射 | | 待验证 | 运行时不进 git |
| 回到同一场景（或分岔/重演到引用该资产的地方） | 不再触发生图请求，直接用缓存图 | | 待验证 | 复用键 = sha1(type+prompt) |
| 刷新页面/断开重连后 | 舞台上那张图还在，不需要重新生成 | | 待验证 | manifest 随 hello 全集下发 |
| 同一句 prompt 在剧本里被两个 id 引用 | 只发一次生图请求，两处都用同一张图 | | 待验证 | 同类型同描述才共用；bg 与 cg 同描述算两张 |
| 把 `STAGE_IMAGE_MODEL` 改成一个不存在的模型后重启，跑到一个会生图的场景 | 演出**完全不受影响**（台词照演，画面是氛围底色），屏幕顶部出现一条可点掉的「生图失败」提示 | | 待验证 | 失败不重试、不跨模型回退 |
| 生图期间在舞台上看语音与节奏 | 语音不断、点击推进正常，骨架不影响演出节奏 | | 待验证 | 文字先行铁律 |
| 在 `assets/backgrounds/` 放一张与生成图同 id 的图 | 舞台上优先显示你导入的那张 | | 待验证 | 静态素材优先，生图只补缺不覆盖 |
| 停掉网关后重启 server，再玩到生图场景 | 同样只是「生图失败」提示，演出正常 | | 待验证 | |

## 验证结论

待验证。

## 已知限制

- **立绘差分不做生图**（`<preload_asset type="sprite">` 只记谱系不发起）：生图一致性不足以出可用的表情差分套图
- 服务端在途 manifest 与磁盘可能漂移（手动删了 `media-cache/img/` 里的图又不重启服务）：重启服务即自动对账
- 工坊里没有「帮我画张背景」按钮：生图由剧作家在演出中自动发起（P6.5 统一重做工坊 UX 时再考虑加显式入口）
