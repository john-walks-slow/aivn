import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 层叠契约的**样式侧**守卫（2026-10-08）。
 *
 * 261008 那次的坑不在结构而在声明：背景栈里的 `z-index`（新图 2 / 旧图 1/4）本身是对的，
 * 错的是没人给 `.theater-stack` 建层叠上下文——栈自己是 `z-index: auto` 的普通元素，
 * 这两个数值就冒泡到最近的那个祖先上下文（`.theater-camera`，它因 `will-change: transform`
 * 自成上下文）里，与同为该上下文成员的立绘层（`z-index: 0`）直接比大小，
 * 2 > 0，整组背景压住立绘，换过一次底之后立绘再也看不见。
 *
 * 注意别把账记到 camera 头上：camera **是**层叠上下文，问题也不在它身上——
 * 在它上面加 isolation 实测无效，因为要收口的是「栈内数值与立绘层比大小」这层关系。
 * 隔离必须落在**数值所在的那一层**。
 *
 * jsdom 不算层叠，组件测试也读不到 CSS（`apps/web/test/spriteLayering.test.tsx` 只钉结构、
 * 删掉 isolation 它照样绿）。所以这里直接读样式表：**数值与隔离成对出现**才是契约，
 * 单看任何一半都看不出病。
 */
const css = readFileSync(fileURLToPath(new URL("./stage.css", import.meta.url)), "utf8");

/**
 * 取一条规则块（选择器需整段匹配）的声明体；找不到返回 null。
 *
 * 只认**顶层扁平规则**（选择器紧跟在文件开头或上一条规则的 `}` 之后、声明体里不再嵌 `{}`）。
 * 将来把舞台样式挪进 `@media` / `@supports` 或改用嵌套写法时，这里会匹配不到——
 * 所以命中多条时直接抛错而不是悄悄取第一条，避免解析器坏了却表现为「测试通过」。
 */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm");
  const hits = [...css.matchAll(re)];
  if (hits.length > 1) {
    throw new Error(
      `选择器 ${selector} 命中 ${hits.length} 条规则——本文件只支持顶层扁平规则：` +
        `请确认选择器能唯一定位，或升级本文件的解析方式。`,
    );
  }
  return hits[0]?.[1] ?? null;
}

function zIndexOf(selector: string): number | null {
  const body = ruleBody(selector);
  const m = body?.match(/z-index:\s*(-?\d+)/);
  return m ? Number(m[1]) : null;
}

describe("背景栈的 z-index 关在自己那一层里", () => {
  it("栈自成层叠上下文——栈内那几档 z-index 才算内部排序", () => {
    expect(ruleBody(".theater-stack")).toMatch(/isolation:\s*isolate/);
  });

  it("栈确实在用栈内 z-index（没有它们，隔离这条也就无从谈起）", () => {
    expect(zIndexOf(".theater-stack .theater-stack-new")).toBeGreaterThan(0);
    expect(zIndexOf(".theater-stack .theater-stack-old")).toBeGreaterThan(0);
  });

  it("立绘层仍是 z-index:0——它是「背景之上、台词条之下」这条链的基准", () => {
    expect(zIndexOf(".theater-sprites")).toBe(0);
  });

  it("隔离落在栈上——camera 那边不用动（它已因 will-change 自成上下文）", () => {
    // camera 是层叠上下文（`will-change: transform` 带来的，实测），但这不是病根：
    // 病根是栈内数值会与同在该上下文里的立绘层比大小。所以 camera 上既不需要
    // 再叠一层 isolation，也不该有 z-index——它一旦有 z-index 就会去和
    // `.theater-overlay`(5) 这些外层兄弟比，把整块画面（连同屏幕遮罩）的顺序搅乱。
    const body = ruleBody(".theater-camera")!;
    expect(body).not.toMatch(/isolation:\s*isolate/);
    expect(body).not.toMatch(/z-index:\s*\d/);
    expect(body).toMatch(/will-change:\s*transform/);
  });
});

describe("转场纯色场是屏幕级的", () => {
  it("纯色场排除了背景栈的范围：它在立绘层（0）之上", () => {
    expect(zIndexOf(".theater-fade-veil")).toBeGreaterThan(0);
  });

  it("纯色场在屏幕遮罩层（flash/黑边/暗角）之下", () => {
    expect(zIndexOf(".theater-fade-veil")!).toBeLessThan(zIndexOf(".theater-overlay")!);
  });

  it("旧的栈内纯色场已经搬走，不留两套", () => {
    expect(ruleBody(".theater-stack-veil")).toBeNull();
  });

  it("纯色场自己带动画，不靠 trans-* 类触发（它只在 fade 那两次换层时入 DOM）", () => {
    expect(ruleBody(".theater-fade-veil")).toMatch(/animation:\s*fx-veil/);
  });

  it("回看时纯色场被抑制——它是镜头容器的孩子，`.theater-stack > *` 那条够不着它", () => {
    const rewinding = css.match(/\.theater-stage\.rewinding[^{]*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(rewinding).toMatch(/\.theater-stage\.rewinding \.theater-fade-veil/);
  });
});
