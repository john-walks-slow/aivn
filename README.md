# Stage-AI Galgame 资产生成与音频管线 (Galgame Assets Pipeline)

本工作树 (`feat/galgame-assets`) 建立了面向 **Stage-AI 视觉小说引擎** 的完整工业级美术与音频生成流水线，涵盖多表情立绘一致性方案、16:9 电影感场景背景与事件 CG、以及 6 大类配乐体系与无缝循环工程。

---

## 快速上手 (Quick Start)

### 1. 环境初始化
```bash
./scripts/init-worktree.sh
```

### 2. 启动可视化资产画廊与交互式预览工作台
```bash
./scripts/dev-worktree.sh
```
脚本将通过 `acquire-port --wait` 动态分配端口，并在终端输出访问地址（如 `http://127.0.0.1:25002/`）。可在网页中：
- 实时切换角色（小春 Koharu）的 7 种表情（普通/微笑/害羞/生气/悲伤/惊讶/闭眼沉思）；
- 在**棋盘格透明底、纯黑底（检验暗部白边）、纯白底**间切换质检；
- 浏览 10 大 16:9 场景背景与事件 CG 画廊；
- 试听 -16 LUFS 广播级标准化的无缝循环 BGM。

---

## 核心脚本与工具链

| 脚本 | 职责与能力 |
|---|---|
| `scripts/gen_sprite.py` | 支持**单图 2x3 Sheet 裁切法**（范式 A）与**首图垫图参考迭代法**（范式 B），输出对齐到 1080x1920 的 32-bit 透明 PNG 与 manifest |
| `scripts/make_transparent.py` | 边缘泛洪连通域保护算法（防挖穿白衬衫/高光）+ 双阈值羽化 + **Despill 边缘去色溢（彻底消除暗色背景白边）** |
| `scripts/gen_cg.py` | 内置 10 大经典 Galgame 场景与事件 CG 预设，支持新海诚/京阿尼风格，自动 16:9 FHD 裁剪重采样与跨服务自动容灾 |
| `scripts/audio_loop_helper.py` | -16.0 LUFS 广播级音量归一化 + **Equal-Power 尾音 Crossfade 无缝循环算法** |
| `scripts/preview_server.py` | 静态画廊与交互式舞台 HTTP 服务 |

---

## 资产目录结构 (`assets/`)

```
assets/
├── sprites/
│   └── koharu/                  # 示例女主角：小春
│       ├── normal.png           # 😐 普通 (1080x1920 RGBA, 锚点 [0.5, 1.0])
│       ├── smile.png            # 😊 微笑
│       ├── shy.png              # 😳 害羞
│       ├── angry.png            # 😠 生气
│       ├── sad.png              # 😢 悲伤
│       ├── surprised.png        # 😲 惊讶
│       ├── thinking.png         # 😌 闭眼沉思
│       ├── sheet_raw.jpg        # 原始 2x3 生成面板
│       └── sprite_manifest.json # 角色立绘契约规范
├── backgrounds/                 # 8 大经典场景背景 (16:9 1920x1080)
│   ├── bg_classroom_sunset.jpg  # 黄昏教室
│   ├── bg_school_gate_sakura.jpg# 飘落樱花校门
│   ├── bg_rooftop_breeze.jpg    # 午后天台微风
│   ├── bg_starry_breakwater.jpg # 繁星海边防波堤
│   ├── bg_library_sunlight.jpg  # 阳光图书馆
│   ├── bg_shrine_steps.jpg      # 夏日神社石阶
│   ├── bg_rainy_station.jpg     # 雨中电车站台
│   └── bg_heroine_bedroom.jpg   # 少女温馨卧室
├── cg/                          # 2 大经典事件 CG
│   ├── cg_rooftop_confession.jpg# 天台递告白信
│   └── cg_rain_umbrella.jpg     # 雨夜共撑一把伞
├── scene_presets.json           # 场景配置元数据清单
└── audio/                       # 音频与配乐体系
    ├── bgm_spec.json            # 6 大类配乐规格与 Suno/MiniMax 提示词
    └── tracks/                  # 实机合成的 -16 LUFS 无缝循环音轨
        ├── bgm_warm_daily_seamless.ogg
        ├── bgm_sad_melancholy.ogg
        └── bgm_cheerful_school.ogg
```

---

## 详细技术文档

请参阅完整技术架构与调研白皮书：
👉 [`docs/galgame-assets-pipeline.md`](docs/galgame-assets-pipeline.md)
