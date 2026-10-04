// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StageModes } from "../src/stage/StageModes.js";

afterEach(cleanup);

/**
 * 左上角常驻标识：只列开着的模式，全关时整块不渲染（常驻的空行是白添的 chrome）。
 * 画面上一行淡痕、没有文字标签，可读名由 title 承担，所以断言认 title 与字形。
 */
describe("StageModes 常驻模式标识", () => {
  const titles = (view: ReturnType<typeof render>) =>
    [...view.container.querySelectorAll(".stage-mode")].map((el) => el.getAttribute("title"));

  it("三种模式全关时不占地方", () => {
    const view = render(<StageModes nsfw={false} muted={false} auto={false} />);
    expect(view.container.querySelector(".stage-modes")).toBeNull();
  });

  it("开着的模式各占一枚，按限制级/静音/自动排", () => {
    const view = render(<StageModes nsfw auto muted={false} />);
    expect(titles(view)).toEqual(["限制级通道", "自动播放"]);
  });

  it("限制级那枚是 NSFW 四个字母，不带文字标签", () => {
    const view = render(<StageModes nsfw muted={false} auto={false} />);
    expect(view.container.querySelector(".stage-mode-nsfw")?.textContent).toBe("NSFW");
  });

  it("静音与自动是淡图标，没有文字", () => {
    const view = render(<StageModes nsfw={false} muted auto />);
    const modes = [...view.container.querySelectorAll(".stage-mode")];
    expect(modes.map((el) => el.textContent)).toEqual(["", ""]);
    expect(modes.map((el) => el.querySelector("svg")?.getAttribute("aria-hidden"))).toEqual([
      "true",
      "true",
    ]);
  });
});
