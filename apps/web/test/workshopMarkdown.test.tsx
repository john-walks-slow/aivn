// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const { WorkshopMarkdown } = await import("../src/workshop/WorkshopMarkdown.js");

const noopOpen = () => {};

afterEach(cleanup);

/** 渲染一段回复，返回 .md-body 容器。 */
function md(text: string) {
  const { container } = render(<WorkshopMarkdown text={text} onOpen={noopOpen} />);
  const body = container.querySelector(".md-body");
  if (!body) throw new Error("没有渲染出 .md-body");
  return body;
}

describe("工坊 markdown 渲染", () => {
  it("单个换行原样留在段落文本里（靠 .md-body p 的 pre-wrap 显形）", () => {
    const body = md("第一行\n第二行");
    const p = body.querySelector("p");
    // 关键：源码里的 \n 还在 DOM 文本中，没有被解析器吃掉。
    // markdown-to-jsx v9 已移除 breaks 选项，单换行不再插 <br>，交给 CSS。
    expect(p?.textContent).toBe("第一行\n第二行");
    expect(p?.querySelector("br")).toBeNull();
  });

  it("空行分出不同段落", () => {
    const body = md("上段\n\n下段");
    expect(body.querySelectorAll("p")).toHaveLength(2);
  });

  it("粗体与行内代码渲染成对应标签", () => {
    const body = md("**重点** 和 `code`");
    expect(body.querySelector("strong")?.textContent).toBe("重点");
    expect(body.querySelector("code")?.textContent).toBe("code");
  });

  it("列表与标题交给解析器，不再是纯文本", () => {
    const body = md("## 小标题\n\n- 甲\n- 乙");
    expect(body.querySelector("h2")?.textContent).toBe("小标题");
    expect(body.querySelectorAll("li")).toHaveLength(2);
  });

  it("同源素材图片渲染成可点灯箱的按钮", () => {
    const body = md("![立绘](/plays/p1/assets/characters/lin.png)");
    const button = body.querySelector("button.md-image");
    expect(button).not.toBeNull();
    expect(button?.querySelector("img")?.getAttribute("src")).toBe(
      "/plays/p1/assets/characters/lin.png",
    );
  });

  it("外链图片不渲染，不给模型往页面塞任意 src 的机会", () => {
    expect(md("![x](https://evil.example/a.png)").querySelector("img")).toBeNull();
    expect(md("![x](javascript:alert(1))").querySelector("img")).toBeNull();
    // 不属于 /plays/<id>/assets/ 的同源路径同样不放行
    expect(md("![x](/api/config)").querySelector("img")).toBeNull();
  });

  it("点灯箱时带上本条消息里所有素材图的索引", () => {
    const opened: Array<{ urls: string[]; index: number }> = [];
    const { container } = render(
      <WorkshopMarkdown
        text={"![甲](/plays/p1/assets/a.png)\n\n![乙](/plays/p1/assets/b.png)"}
        onOpen={(images, index) => opened.push({ urls: images.map((i) => i.url), index })}
      />,
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>("button.md-image");
    buttons[1]?.click();
    expect(opened).toEqual([{ urls: ["/plays/p1/assets/a.png", "/plays/p1/assets/b.png"], index: 1 }]);
  });
});