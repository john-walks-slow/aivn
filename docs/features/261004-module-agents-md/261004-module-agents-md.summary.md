# module-agents-md 实施总结

拆掉「根 `AGENTS.md` 单行 1 万字符」这块债务：把三个巨型单行按模块拆成模块级指引，根只留导航与跨模块内容。**一条信息都没丢**，用脚本逐字核对过。

- 基线：`main@ecb60e8`（拆的是这一版的根 `AGENTS.md`）
- 分支 / worktree：`docs/module-agents-md` / `.worktrees/module-agents-md`
- 只动 Markdown：新增 2 个模块级指引、重写根指引；代码与 `.gitignore` 一字未动

## 为什么必须拆

| 指标 | 拆前 | 拆后 |
| --- | --- | --- |
| 根 `AGENTS.md` 行数 | 3 | 21 |
| 根 `AGENTS.md` 字符数 | 14316 | 852 |
| 最长行 | 10258 | 190 |
| `apps/web/AGENTS.md` | 不存在 | 48 行 / 3905 字符（最长行 367） |
| `apps/server/AGENTS.md` | 不存在 | 141 行 / 10688 字符（最长行 396） |

根指引的 3 行分别是 apps/web 段（3740 字符）、library 段（318 字符）、apps/server 段（10258 字符）。agent 的 `read` 工具按行截断（2000 字符/行），这三行**都读不进来**——而按项目规范，进行任何工作前必须先读这份文件。

**拆前的实际状态是：这份「必读文件」谁也读不了，只能靠 `git diff --word-diff` 一格一格看。** 同一天两个 agent 各改一次，16k 的单行冲突手工解不出来。

## 拆分方案

### 落到哪里

| 原内容 | 去向 | 理由 |
| --- | --- | --- |
| `apps/web` 段（line1） | `apps/web/AGENTS.md` | 就是该模块自己的指引，符合 `{module_path}/AGENTS.md` 约定；在 `apps/web/` 下工作时会被自动作为模块指引加载 |
| `apps/server` 段（line3） | `apps/server/AGENTS.md` | 同上 |
| `library` 段（line2） | 留在根 `AGENTS.md` 的「素材资源库（library/）」一节 | `library/` **整个目录不进 git**（`.gitignore` 里是 `/library/*`），`library/AGENTS.md` 提交不了。这段本身讲的是「这个目录是什么、运行时怎么读」，属于跨模块事实，放根不违和 |
| 仓库总览、目录导航 | 根 `AGENTS.md` 新增 | 拆完必须有人告诉后来者「模块指引在哪」，否则等于把一份文件变成三份没人知道的文件 |

### 切成什么样

两种结构，都按 `update-module-instruction` 的路子（小节标题 + 一条事实一行）：

- `apps/web/AGENTS.md`：`## 职责` / `## 地图与界面约定` / `## 舞台（src/stage/）`。`src/workshop/` 与 `src/stage/` 原文是一长串括号内用 ` + `、`、` 并列的面板清单，改成「父条目 + 子条目」——一层缩进换掉 300 字符的逗号串。
- `apps/server/AGENTS.md`：17 个小节（职责 / agentkit / DSL 与 IR / 工坊线程 / 素材台账 / 立绘 / 生图后端 / 提示词装配 / 看图 / 引用即导入 / 出图内核与手动生图 / 生图配置 / 服务入口 / 技能库 / 创作口径 / 设置面板 / NSFW）。小节标题是**新加的**，正文全部来自原文。

与 `update-module-instruction` 的四段模板（职责 / 地图 / 核心设计 / Pitfalls）的差异：`apps/web` 保留「职责 + 地图 + 舞台（src/stage/）」，`apps/server` 用了 17 个小节而不是 4 个。88 条事实塞进四个小节只会得到四个巨型列表，等于把「读不完的一行」换成「读不完的一节」；按主题分小节才能扫见标题就知道去哪一节找。两份文件都远低于该规范 300 行的上限。Pitfalls 没有单独成节——原文里的坑都是与具体机制绑在一起写的（「那里曾写着 twin tails…」「3:4/4:3 曾被网关接反…」），抽出来单列就得改写措辞，而这轮明确只做切分。

切分规则（脚本执行，不是手工粘贴）：

1. 在括号深度 0 的句末标点（`；`、`。`）处切句——这样括号内的枚举不会被误切。
2. 个别超长括号（如 `src/workshop/` 与 `src/stage/` 两处）用显式标记切到括号内部的一层并列。
3. 除「换行位置」「小标题」「句末标点（`；`→`。`、补句号）」之外，不改动任何字符。正文行内不折行，与仓库既有 Markdown 风格一致（README 与 `docs/` 里的长句本来就是一行一句，最长 482 字符）。

## 映射表

「覆盖原文区间」是在**剔除标点与 markdown 标记后的内容字符序列**上的下标（原文 line1 共 2955、line3 共 8091、line2 共 251 个内容字符）。区间连续、无空洞、合计等于原文长度——即每一条都按原顺序取自原文，没有跳过也没有重复。

### `apps/web/AGENTS.md` ← 原 line1（3740 字符，内容 2955）

| 小节 | 覆盖原文区间 | 条数 |
| --- | --- | --- |
| 职责 | 0–84 | 1 |
| 地图与界面约定 | 84–1571 | 18 |
| 舞台（src/stage/） | 1571–2955 | 18 |

### `apps/server/AGENTS.md` ← 原 line3（10258 字符，内容 8091）

| 小节 | 覆盖原文区间 | 条数 |
| --- | --- | --- |
| 职责 | 0–99 | 1 |
| agentkit：两个 agent 的共用基座 | 99–1373 | 13 |
| DSL、轮收束与 IR 事件 | 1373–1633 | 2 |
| 工坊线程（压缩、消息文件与文件工具） | 1633–2745 | 11 |
| 素材、出图与台账 | 2745–3174 | 5 |
| 立绘：后缀、景别与画幅 | 3174–3809 | 7 |
| 生图后端 | 3809–3950 | 2 |
| 提示词装配 | 3950–4755 | 12 |
| 看图（view_image） | 4755–5051 | 4 |
| 引用即导入（资源库） | 5051–5503 | 7 |
| 出图内核与手动生图 | 5503–6015 | 6 |
| 生图配置（接口格式、画幅与尺寸） | 6015–6496 | 3 |
| 服务入口、端点与记账 | 6496–6940 | 5 |
| 技能库与新剧目初始状态 | 6940–7241 | 2 |
| 创作口径与剧目记忆 | 7241–7461 | 1 |
| 设置面板与配置面 | 7461–7891 | 4 |
| 限制级（NSFW）通道 | 7891–8091 | 3 |

### 根 `AGENTS.md` 的「素材资源库（library/）」 ← 原 line2（318 字符，内容 251）

| 小节 | 覆盖原文区间 | 条数 |
| --- | --- | --- |
| 素材资源库（library/） | 0–251 | 4 |

## 机械核对

只比对**内容字符**：剔除空白、markdown 标记（`# * - + \``）与全部标点（中英文两套）后，要求「新文件拼起来」与「原文」逐字全等。这样小标题、换行、`；`→`。`、`（）`→缩进这些结构变化都不影响判定，而**任何一个实词、标识符、路径、数字、代码片段丢失或错位都会报 FAIL**。

把下面这段存成 `check_agents_md.py`，在仓库根跑 `python3 check_agents_md.py .`（比对 `git show HEAD:AGENTS.md` 与工作区的三份文件）：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核对拆分没有丢信息：只比对「内容字符」，忽略所有 markdown 结构字符与标点。

    python3 check_agents_md.py <repo> [<dir>]
"""
import subprocess, sys, os

PUNCT = set(' \t\n\r#*-+`、；：，。！？（）()「」《》“”‘’…—·.,:;!?"\'')

def sig(t):
    return ''.join(c for c in t if c not in PUNCT)

def body(path, section=None):
    lines = open(path, encoding='utf-8').read().split('\n')
    if section:
        start = next(i for i, l in enumerate(lines) if l.startswith('## ' + section))
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
        lines = lines[start + 1:end]
    out = []
    for l in lines:
        s = l.strip()
        if not s or s.startswith('#'):
            continue
        if s.startswith('- '):
            s = s[2:]
        out.append(s)
    return sig(''.join(out))

def main():
    repo = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else repo
    old = subprocess.run(['git', '-C', repo, 'show', 'HEAD:AGENTS.md'],
                         capture_output=True, text=True, check=True).stdout.split('\n')
    pairs = [
        ('AGENTS.md 第 1 行（apps/web）', sig(old[0][2:]), body(os.path.join(out, 'apps/web/AGENTS.md'))),
        ('AGENTS.md 第 3 行（apps/server）', sig(old[2][2:]), body(os.path.join(out, 'apps/server/AGENTS.md'))),
        ('AGENTS.md 第 2 行（library）', sig(old[1][2:]),
         body(os.path.join(out, 'AGENTS.md'), section='素材资源库（library/）')),
    ]
    bad = 0
    for name, a, b in pairs:
        ok = a == b
        bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}: 原 {len(a)} 字 / 新 {len(b)} 字")
        if not ok:
            i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
            print(f'      首个差异 @{i}: 原 …{a[max(0,i-30):i+30]}…')
            print(f'                     新 …{b[max(0,i-30):i+30]}…')
    print('全部一致' if not bad else f'{bad} 处不一致')
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
```

本轮的运行结果：

```
PASS  AGENTS.md 第 1 行（apps/web）: 原 2955 字 / 新 2955 字
PASS  AGENTS.md 第 3 行（apps/server）: 原 8091 字 / 新 8091 字
PASS  AGENTS.md 第 2 行（library）: 原 251 字 / 新 251 字
全部一致
```

另有两道旁证：

- `node scripts/check-encoding.mjs AGENTS.md apps/web/AGENTS.md apps/server/AGENTS.md` → 通过（无 UTF-8 替换字符，长中文正文在写入链路上没有掉字节）。
- 映射区间连续无空洞、合计等于原文内容字符长度（见上表），说明每条都按原顺序取自原文。

## 顺手修掉的两处原文笔误

拆的时候逐字对账才发现的，都属于标点/格式，不涉语义：

1. `library` 一节的最后一条漏了收尾反引号（`` …seed-sources.research.md `` 少了闭合的 `` ` ``），补上。
2. `apps/server` 段「…否则会留下一个永远填不上的骨架」后面是 `。。`，收敛成一个句号。

## 后续维护

- 以后改 `apps/web` 就在 `apps/web/AGENTS.md` 里改，改 `apps/server` 就在 `apps/server/AGENTS.md` 里改；根指引只放导航与跨模块事实（目录总览、library）。**不要再往根指引里堆模块细节**，否则这份文件会重新长回拆之前的样子。
- 若再有人往根指引里加了一整段，按同一办法再拆一次即可：切分只做「换行 + 小标题 + 句末标点」，`check_agents_md.py` 负责证明没丢东西。
- 本轮拆的是 `main@ecb60e8` 的内容。若之后 main 又改了根 `AGENTS.md`，合并时按同样方式把新段落落到对应模块文件（这次已按最新 main 重做，正常合并无冲突面）。
