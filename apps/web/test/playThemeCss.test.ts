import { describe, expect, it } from "vitest";
import { PLAY_ACCENTS, accentFromThemeCss, themeCssFor } from "../src/ui/playTheme.js";

/**
 * 生成的 theme.css 是「剧目主题色 → 界面与舞台」的唯一入口，它的令牌名有契约：
 * 界面读 --accent，舞台读 --play-accent——舞台根 .stage-root 自己也声明了 --accent，
 * 从 :root 继承下来的值进不去，少了 --play-accent 就是「界面换了色、舞台还是引擎蓝」。
 * 这条契约只在 CSS 里生效，组件测试看不见，所以在这儿钉住。
 */
describe("剧目 theme.css 的生成", () => {
  it("两个名字都给，墨色成对", () => {
    const css = themeCssFor("#2f7f6f")!;
    expect(css).toContain("--accent: #2f7f6f;");
    expect(css).toContain("--play-accent: #2f7f6f;");
    expect(css).toContain("--play-accent-ink: #ffffff;");
    expect(css).toContain("--accent-ink: #ffffff;");
  });

  it("暖黑那一档是提过明度的同一个色相（否则主题色当字压在暖黑上读不清）", () => {
    const css = themeCssFor("#2f7f6f")!;
    expect(css).toContain('html[data-ui-theme="dark"] {');
    expect(css).toMatch(/--play-accent-dark: #5d9b8f;/);
    expect(css).toMatch(/--accent: #5d9b8f;/);
    // 提完的色更亮：认得出是同一支色相、而且能当字用
    expect(css).not.toContain("--play-accent-dark: #2f7f6f;");
  });

  it("不给 --accent-soft：它是纸面/暖黑两回事，由 app.css 现推", () => {
    expect(themeCssFor("#c2557f")).not.toMatch(/^\s*--accent-soft:/m);
  });

  it("浅主色配深墨（亮底上留白字等于看不见）", () => {
    expect(themeCssFor("#ffe08a")).toContain("--accent-ink: #0e1a1b;");
  });

  it("不认的色值不生成表；空值 = 默认主题的空表", () => {
    expect(themeCssFor("rebeccapurple")).toBe("");
    expect(themeCssFor(null)).toContain("默认主题");
  });

  it("色板八档都回读得出来（工坊色板的选中态靠它）", () => {
    for (const accent of PLAY_ACCENTS) {
      expect(accentFromThemeCss(themeCssFor(accent.hex))).toBe(accent.hex);
    }
  });
});
