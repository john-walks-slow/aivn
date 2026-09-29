# 应用级资源库 · 交付总结

## 做了什么

给 stage-ai 加了一个**应用级素材资源库**：本地目录 `library/`，一剧一素材地攒起来，每部剧从里面挑着导入，元数据一路落到剧目里、进而被剧作家（playwriter）看见并用来编排 BGM 与音效。

同时补完了一直半残的音频机制——`ambient` 属性此前**客户端从没消费过**，BGM 换景漏写就断、没有停止手段、没有淡入淡出，SFX 无并发上限。

## 三块交付

### 1. 资源库本身

```
library/
  backgrounds/bg_classroom_sunset/{meta.json, bg_classroom_sunset.jpg}
  sprites/nanase/{meta.json, neutral.png, smile.png, worried.png, surprised.png}
  bgm/bgm_rainy_night/{meta.json, bgm_rainy_night.mp3}
  sfx/sfx_rain/{meta.json, sfx_rain.mp3}
```

**目录名即素材 id**，id 原样成为剧目文件名主体与剧本引用名。服务端 `AssetLibrary` **只读**——没有写接口是产品决定，不是没做：用户在本地目录里用文件管理器摆素材，浏览器只负责「浏览、搜索、导入」。

当前库里 66 条：12 背景 + 1 个立绘包（4 差分）+ 20 BGM + 33 SFX，约 20MB，扫描 0 告警。

### 2. 元数据贯通

`AssetMeta` 现在带描述、标签、情绪、适用场景、时长、是否可循环、音量。**导入时随文件一起复制进剧目**的 `assets/manifest.json`，立绘还顺带合并 `play.json` 的角色卡。

这是整件事的关键：元数据不进剧目，剧作家 A 区里看到的还是一串光秃秃的文件名，「按情绪选曲」无从谈起。

导入是**复制不是引用**——剧目包能导出、静态服务零改动、用户把资源库删了老剧照样开演。代价是同一个背景在几部剧里存几份，这个取舍是有意接受的。

### 3. 音频机制补完

- `bgm` / `ambient` 两块常驻通道，1.2 秒交叉淡入淡出（客户端固定，**不给模型旋钮**）
- 语义定死：**缺省 = 保持当前**，`none` = 停。这层三态语义必须原样穿过谱系
- 音量属性 `bgm_volume` / `ambient_volume` / `sfx volume` 跟着事件流往返
- `ambient` 独立通道，sfx 与 bgm 两个目录都认（环境音放哪一类取决于用户怎么归类）
- SFX 并发上限 6，挤掉最老的一条——同帧狂触发会叠成噪音

## 界面

工坊「素材」tab 里加了「从资源库导入」入口，进去是一个浏览面板：分类 tab（带各类条目数）、防抖搜索、网格卡、图片灯箱、音频试听，导入后卡片变「已导入 / 覆盖」。

工坊 agent 侧多了 `list_library` / `import_asset` 两个工具，能只靠工具找到并导入素材，导入的改动会进撤销条（**导入改的是剧目配置，得能反悔**）。

## 最值得记的一个坑

剧目配置的读改写竞态。`play.json` 与 `assets/manifest.json` 的写入方散在 http / workshop / workshopAssets / assetImport 四处，全是「读全量 → 改一项 → 写回」，裸做就是后写的拿旧值把先写的整份覆盖——用户的现象是「刚出的表情在角色卡里消失了」。

第一版修法在 `assetImport.ts` 挂了把 `WeakMap<PlayStore>` 队列，看着对，还写了并发测试，**测试是绿的**。第二轮检视才发现：`PlayLibrary.store()` 每次调用都 `new PlayStore(...)`，每个 HTTP 请求持有不同实例，**队列直接穿透，等于没锁**。而当时的单测恰好把所有并发调用都指向同一个 `store` 变量，恰好让 key 对上了，把这个洞测成了「通过」。

第二版把锁挪到存储层 `store.ts`，key 用剧目目录绝对路径（`withPlayConfigLock(store.dir, …)`，并 `resolve()` 归一化），并发用例改成每次调 `plays.store("p1")` 取新实例。改完做了一次反向验证：故意把 key 换回对象身份，两条并发用例当场失败。

教训是：**并发测试如果共享了被锁保护的那个对象，它测的就是假象**。

## 数字

| 项 | 数量 |
| --- | --- |
| 测试 | core 85 / web 28 / server 229 全绿（3 例生图 e2e 默认 skip） |
| 库条目 | 66（12 背景 + 1 立绘包 + 20 BGM + 33 SFX） |
| 检视 | 三轮，最终准入 |

## 遗留

- BGM 听感机器判断不了，留了 5 条待人工试听清单（见 `seed-sources.research.md`）。`bgm_rainy_night` 原曲 278s 剪到 30s、`bgm_snowfall_loop` 给本无缝的循环加了 30ms 淡入淡出，接上可能仍有接缝
- `bg_photo_corridor` 实拍自南亚学校走廊不是日式校园，已在 `meta.json` 注明
- `bg_hd_parallax_glitch` 因 Starling 图层包被拍平成黄洞，未入库
