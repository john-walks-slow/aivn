// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StageModes } from "../src/stage/StageModes.js";

afterEach(cleanup);

/**
 * 左上角常驻标识：只列开着的模式，全关时整块不渲染（常驻的空行是白添的 chrome）。
 */
describe("StageModes 常驻模式标识", () => {
  it("三种模式全关时不占地方", () => {
    const view = render(<StageModes nsfw={false} muted={false} auto={false} />);
    expect(view.container.querySelector(".stage-modes")).toBeNull();
  });

  it("开着的模式各占一枚，按限制级/静音/自动排", () => {
    const view = render(<StageModes nsfw auto muted={false} />);
    const labels = [...view.container.querySelectorAll(".stage-mode")].map((el) => el.textContent);
    expect(labels).toEqual(["限制级通道", "自动"]);
  });

  it("静音单独开着也看得见", () => {
    const view = render(<StageModes nsfw={false} muted auto={false} />);
    expect(view.container.querySelector(".stage-modes")?.textContent).toBe("静音");
  });
});
