#!/usr/bin/env python3
"""从 AIVN 的 app.css 里抽出 @aivn/stage 漏搬的规则，生成可粘贴的 CSS 片段。

背景：`packages/stage/src/stage.css` 是从 `apps/web/src/app.css` 手工搬的，漏了一大段——
`.choice*`（选项卡片本身）、`.modal-*`、`.ref-picker-*`、`.dir-btn`、全局 `button` /
`input` 底样式，以及整个移动端 `@media (max-width: 720px)` 小节。没有 `.choice*`，
选项就是浏览器默认按钮的样子、位置也不对。

按**白名单**抽：只搬插件真正会渲染的组件用到的选择器。首轮（2026-10-05）只认
`StageTheater` / `StopPanel` / `ToastStack` / `ui/Modal` / `ui/RefCharacterPicker`，
导演栏与回顾面板当时插件还不渲染，所以没搬；2026-10-06 插件接上导演栏（提示 / 改写 /
重写，含引导·打断两岔与 OOC 输入）与模式标识、回顾面板之后，白名单补上这几组——
插件的提示弹窗曾因此只有 `.modal-*` 壳子、里面的分段控件与输入框是裸的。
路由树仍不搬。原文照抄，两处加工：

- 元素级选择器加 `:where(.stage-root)` 前缀——`:where()` 特异性为零，既把作用域圈在
  舞台子树里，又不改变它与 `.choice` 这类类规则之间的胜负关系（直接写 `.stage-root button`
  会变成 0,1,1，反过来压掉 `.choice`）。
- 多选择器规则里只保留白名单里的那几段（`.theater-bar, .theater-dialog, .settings-footer, …`
  只留前两个），宿主的 `.library` / `.settings-*` 不许跟着进来。

用法：python3 scripts/port-stage-css.py
"""
import re
import sys
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent


def pick(*candidates: Path) -> Path:
    """第一个存在的路径。脚本在 worktree 里跑时路径与主仓不同，两边都认。"""
    for path in candidates:
        if path.exists():
            return path
    raise SystemExit(f"找不到文件：{[str(c) for c in candidates]}")


APP_CSS = pick(HERE.parent / "apps/web/src/app.css")
STAGE_CSS = pick(
    HERE.parent / "packages/stage/src/stage.css",
    HERE.parent / ".worktrees/dsh-vn-stage/packages/stage/src/stage.css",
)

ELEMENT_TAGS = {"button", "input", "textarea", "select"}
# 元素级规则连状态一起认：`button:hover:not(:disabled)`、`input:focus` 也要跟着搬
ELEMENT_RE = re.compile(r"^(?:button|input|textarea|select)(?::[\w-]+(?:\([^)]*\))?)*$")

CLASSES = {
    ".muted", ".small", ".muted.small",
    "button.ghost-btn", "button.ghost-btn:hover:not(:disabled)",
    "button.link-btn", "button.primary", "button.primary:hover:not(:disabled)",
    ".choice-overlay", ".choice-overlay .choice", ".choice-text", ".choice",
    ".choice:hover:not(:disabled)", ".choices",
    ".theater:has(.choice-overlay) .theater-stage::after",
    ".modal-scrim", ".modal-card", ".modal-head", ".modal-title", ".modal-x",
    ".modal-x:hover", ".modal-hint", ".modal-body", ".modal-foot",
    ".modal-foot .free-back", ".free-box", ".free-box input", ".free-back",
    ".ref-picker-grid", ".ref-picker-chip", ".ref-picker-chip:hover",
    ".ref-picker-chip.selected", ".ref-chip-thumb", ".ref-chip-blank",
    ".ref-chip-name", ".ref-chip-order", ".ref-picker-empty",
    ".image-gen-field", ".image-gen-label", ".image-gen-checkbox",
    ".theater-bg-in", ".theater-cg-in", ".toast-stack", ".toast",
    ".dialog-foot", ".dialog-hint-foot", ".dialog-options",
    ".dialog-options .dir-btn", ".dir-btn", ".dir-btn:hover:not(:disabled)",
    ".dir-btn.on", ".dir-btn.tgl-on", ".dir-btn.voice-pending", ".dir-btn:disabled",
    ".theater-bar", ".theater-dialog", ".theater-scene", ".dialog-text",
    # 2026-10-06 补：插件接上导演栏与回顾面板之后，这些也在插件里渲染了。
    ".seg", ".seg .seg-btn", ".seg .seg-btn.active",
    ".director-input", ".ooc-shortcut", ".ooc-shortcut:hover", ".ooc-shortcut.on",
    ".backlog-panel", ".backlog-list", ".backlog-list b", ".backlog-empty",
    ".backlog-panel > .muted",
    ".bl-tools", ".bl-tool", ".bl-tool:hover:not(:disabled)", ".bl-tool:disabled",
    ".bl-edit", ".bl-edit input",
    ".bl-text", ".bl-text.current", ".bl-player .bl-text b", ".bl-input .bl-text",
    ".stage-modes", ".stage-mode", ".stage-mode-nsfw",
    ".theater-bg-pending", ".theater-cg-pending",
}

MOBILE = {".theater-bar", ".theater-scene", ".theater-dialog", ".dialog-text",
          ".choice-overlay", ".choice"}

KEYFRAMES = {"choice-in", "bg-fade"}


def walk(css):
    """按顺序产出 (at_context, selector, body)。只认一层 @media 嵌套，够 app.css 用。"""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out, token, context, i = [], [], None, 0
    while i < len(css):
        ch = css[i]
        if ch == "{":
            head = " ".join("".join(token).split())
            token = []
            if head.startswith("@media") or head.startswith("@supports"):
                context = head
                i += 1
                continue
            depth, j = 1, i + 1
            while j < len(css) and depth:
                depth += css[j] == "{"
                depth -= css[j] == "}"
                j += 1
            out.append((context, head, css[i + 1:j - 1]))
            i = j
            continue
        if ch == "}":
            context, token = None, []
            i += 1
            continue
        token.append(ch)
        i += 1
    return out


def stage_selectors():
    """stage.css 里已有的选择器**逐个**收集（按逗号拆开）。

    不拆的话，一条 `A, B` 的合并规则只以整串进集合，`A` 单看就「没有」——
    补搬时会把它原样再写一遍，同一批规则搬两遍（2026-10-06 实测）。
    """
    css = re.sub(r"/\*.*?\*/", "", STAGE_CSS.read_text(), flags=re.S)
    out = set()
    for m in re.finditer(r"([^{}]+)\{", css):
        for part in m.group(1).split(","):
            part = " ".join(part.split())
            if part:
                out.add(part)
    return out


def keep_parts(sel, pool):
    return [
        p.strip()
        for p in sel.split(",")
        if p.strip() in pool or ELEMENT_RE.match(p.strip())
    ]


def scope(part):
    return ":where(.stage-root) " + part if ELEMENT_RE.match(part) else part


def main():
    already = stage_selectors()
    pool = CLASSES
    base, mobile = [], []
    for at, sel, body in walk(APP_CSS.read_text()):
        if sel.startswith("@keyframes"):
            if sel.removeprefix("@keyframes").strip() in KEYFRAMES and sel not in already:
                base.append((sel, body))
            continue
        if at and "max-width: 720px" in at:
            # 移动端整段都没搬过，不能按选择器去重——`.theater-dialog` 这种在基础小节里
            # 已经有了，但它在移动端是另一套尺寸（min-height 96px），漏了就白搬。
            parts = keep_parts(sel, MOBILE)
            if parts:
                mobile.append((at, ", ".join(parts), body))
            continue
        if at:
            continue
        # 先加 `:where(.stage-root)` 再比「有没有搬过」：stage.css 里收的就是加了作用域
        # 的写法，拿裸 `button` 去比永远比不中，元素级规则会被无脑重搬一遍。
        parts = [p for p in (scope(p) for p in keep_parts(sel, pool)) if p not in already]
        if not parts:
            continue
        base.append((", ".join(parts), body))

    print("/* ── 从 app.css 补搬的规则（scripts/port-stage-css.py 生成，别手改这一节）───")
    print("   白名单在脚本的 `CLASSES` / `MOBILE`：只搬插件真正会渲染的组件用到的选择器。")
    print("   原文照抄，只在元素级选择器上加 `:where(.stage-root)` 圈作用域——`:where()`")
    print("   特异性为零，不改它与 `.choice` 这类类规则之间的胜负关系。 */\n")
    for sel, body in base:
        print(sel + " {")
        for line in textwrap.dedent(body).strip().splitlines():
            print("  " + line.rstrip() if line.strip() else "")
        print("}\n")

    if mobile:
        print("/* 移动端（≤720px）：台词条与选肢卡的紧凑尺寸，安全区由上面的 env() 兜 */")
        by_at = {}
        for at, sel, body in mobile:
            by_at.setdefault(at, []).append((sel, body))
        for at, items in by_at.items():
            print(at + " {")
            for sel, body in items:
                print("  " + sel + " {")
                for line in textwrap.dedent(body).strip().splitlines():
                    print("    " + line.rstrip() if line.strip() else "")
                print("  }")
            print("}")


if __name__ == "__main__":
    sys.exit(main())
