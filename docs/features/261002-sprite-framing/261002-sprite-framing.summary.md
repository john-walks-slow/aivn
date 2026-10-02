# 立绘取景（sprite framing）—— 实施记录

日期：2026-10-02
状态：已实现并自验（core/server/web 三层 + 资源库 20 个条目 + 文档）

## 一、要解决的问题

资源库里两批立绘的取景不一样：

- 旧的 `onboroo_*` / `breezy_*` / `nanase`：全身或近全身
- 新入的 `potato_*` / `platonic_*`：半身（腰上）

舞台的 `.theater-sprite` 是**照全身立绘调的**（`height:115%; bottom:-24%`，注释写明「可见部分是『大腿以上』」）。把半身图按同一套数值放进去，人物整体下坠、头掉到画面中段，切换差分时人物还会「跳」一下。

## 二、关键实测：图像尺寸测不出取景

用 PIL `getchannel("A").getbbox()` 量人物实际占位：

| 素材 | 取景 | 尺寸 | 宽高比 | 人物占画幅高 | 头顶留白 |
| --- | --- | --- | --- | --- | --- |
| platonic_a | 半身 | 2149×3035 | 0.708 | 89.9% | 10.1% |
| potato_chinatsu | 半身 | 720×1080 | 0.667 | 79.7% | 20.3% |
| potato_kioshi | 半身 | 580×1080 | 0.537 | 95.6% | 4.4% |
| onboroo_girla | 全身 | 2200×3500 | 0.629 | 90.5% | 9.5% |
| breezy_lyn | 近全身 | 914×1478 | 0.618 | 95.9% | 4.1% |
| nanase | 全身 | 1080×1920 | 0.562 | 99.7% | 0.2% |

**两类的宽高比（0.54~0.71）与人物占画幅高（80~100%）高度重叠**。差别在「头相对整幅多大」，那是语义不是像素。

结论：**任何图像尺寸启发式都会把腰上半身和全身判成同一类。取景只能声明，不能自动检测。**

## 三、实现

### 1. 契约（`packages/core/src/play/framing.ts`，新增）

`SpriteFraming = "bust" | "half" | "full"`，缺省 `full`（存量 play.json 不带这个字段，行为必须与加字段之前一模一样）。同文件带三张表：

- `SPRITE_FRAMING_LABELS`：显示名（资源库 / 角色卡 / 演出层共用）
- `SPRITE_FRAMING_ASPECT`：出图画幅 full `9:16` / half `2:3` / bust `3:4`
- `SPRITE_FRAMING_SHOT`：进 prompt 的景别措辞

**画幅跟着取景走**：胸像半身脸占画幅近一半，仍按 9:16 出会被拉成一张窄条。三个画幅都在 `imageBackend.ts` 的白名单内（两款接口的交集）。

### 2. 落点：两级，都支持

| 位置 | 字段 |
| --- | --- |
| `AssetMeta.framing` | 角色包级取景 |
| `SpriteExpression.framing` | 差分级覆盖（一套里混特写差分时用） |
| `CharacterCard.framing` / `.spriteFraming` | play.json 侧，舞台读它 |

解析都逐字段校验：写错的值当没写（退回缺省），而不是让舞台去查一个不存在的 CSS 类。`parseCharacter` 是 `parsePlayConfig` 里新加的一道，整张表都非法时整个字段消失、不留空对象。

### 3. 数据流

- **导入**（`assetImport.ts`）：条目级与差分级取景搬进角色卡。差分级是**合并**而非替换——只导一条 `smile` 不该把同角色其它差分的取景覆盖抹掉。条目没声明时不动剧目侧的值。
- **出图**（`playAssets.ts`）：优先级 = 调用方显式给 > 该差分的覆盖 > 角色级 > 全身。画幅与 prompt 景别都跟着走，中性定妆照**同时立角色级默认**。出图后回写 play.json（`mapSprite`）。
- **工具参数**（`imageTool.ts`）：`generate_image` 加 `framing` 参数，两个角色都给（剧作家的 neutral 定妆照同样要选景别）。`PROMPT_RULES` 与 `QUEUED_DESCRIPTION` 的画幅描述同步。
- **舞台**（`StageTheater.tsx` + `assets.ts` + `app.css`）：`AssetIndex.spriteFraming()` 查差分覆盖 → 角色声明 → 全身，渲染成 `framing-*` 类。

### 4. 舞台预设

```css
.framing-full { height: 115%; bottom: -24%; }   /* 与改动前逐字一致 */
.framing-half { height: 100%; bottom:  -4%; }
.framing-bust { height:  78%; bottom:   6%; }
```

竖屏（`max-aspect-ratio: 1/1`）另有一套（96/-6、86/6、70/12）。

**按用户要求不做头高对齐**：三档之间只保证「台词条以上看到哪儿」大致一致。半身立绘的头本来就该比全身的大，那正是「半身」的含义。

选肢浮层那条 `.theater-stage:has(.choice-overlay) .theater-sprite { bottom:46%; height:58% }` 特异性更高，三档都被它统一压过去——选肢时把脸让出来是临时状态，本来就该一刀切。

## 四、渲染验证

用**现 CSS 的真实数值**搭模拟舞台（`/tmp/spr/framing-presets.html`），拿资源库真实素材渲染三档（`google-chrome --headless --screenshot`），modlens 判读：

- **full**：台词条以上看到大腿/膝，头顶有余量 —— 与改动前完全一致（存量剧目不受影响）
- **half**：看到腰/胯，头完整、头顶留白充足，头明显更大（半身的应有之义）
- **bust**：合成一张真 3:4 胸像（`/tmp/spr/bust-sample.png`）验证：头完整未被裁，到腰

> 用半身素材当「胸像」演示是无效的——源图本来就是半身，套 bust 预设当然显得比例不对。bust 那一格必须用真胸像源图才验得出。

**同一幕混用三档会显得不协调，这是预期不是 bug**。galgame 的惯例是按这一幕最「近」的角色定整屏取景；这一点写进了 README。

## 五、两个实现期发现的设计问题

1. **自动补的定妆照不能按差分的取景出**。中性定妆照是所有差分的垫图基准：一个「全身角色 + 一条 closeup 差分」，若自动把定妆照补成胸像，其余每条差分的垫图就都是胸像了。为此 `AssetSpec` 加了 `baseFraming`（角色级取景），`ensureNeutral` 按它出。
2. **差分 prompt 也得点明景别**。垫图是全身时模型很容易照着垫图把一条 closeup 也画成全身，`identitySuffix` 里因此带上 `SPRITE_FRAMING_SHOT`。

## 六、测试

| 位置 | 覆盖 |
| --- | --- |
| `packages/core/test/config.test.ts` | 取景逐字段校验、存量卡不带字段、整表非法时字段消失 |
| `packages/core/test/assets.test.ts` | 条目级与差分级解析，坏值丢掉、好的留下 |
| `apps/server/test/playAssets.test.ts` | 三档画幅与景别、play.json 声明被沿用、差分覆盖优先、回写、中性照立角色默认、差分 prompt 带景别 |
| `apps/server/test/assetLibrary.test.ts` | 导入搬取景、只导一条差分不抹掉其它差分的覆盖 |

顺带把测试里的 `realImage()` 从「只认 9:16」改成按请求画幅推尺寸——否则新画幅的桩会自己造一张回执不符的图。

`@stage-ai/core` 98 passed；server 相关 8 个 suite 194 passed；`pnpm -r build` 通过。

## 七、自评与遗留

**没做的**：

- 没做头高对齐（用户明确不要）。
- 没给 bust 档补资源库素材：库里两批都是半身或全身，胸像只能靠站内生图（`framing: "bust"`）出。
- 没做「同一幕取景不一致」的运行时提示。那属于演出规则而非排版问题，写在 README 的建议里就够。

**风险**：源图自带的顶部留白差异很大（potato_chinatsu 20.3% vs potato_kioshi 4.4%），同样标 `half` 的两张图在屏幕上头顶位置仍会差一截。这是源图本身的差异，不是预设能消掉的——预设只能管「可见到哪儿」。