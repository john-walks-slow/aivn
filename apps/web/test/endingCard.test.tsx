// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EndingCard } from "@aivn/stage";

afterEach(cleanup);

describe("结局卡 EndingCard", () => {
  it("没有 title 时主标题回落 id", () => {
    render(<EndingCard ending={{ id: "bad_end" }} />);
    expect(screen.getByRole("heading").textContent).toBe("bad_end");
  });

  it("标题 / 副标题 / 收束散文都渲染", () => {
    render(
      <EndingCard
        ending={{ id: "true_sunrise", title: "晨光", subtitle: "这一次，她没有回头" }}
        summary="风停了，她也没有再回头。"
      />,
    );
    expect(screen.getByRole("heading", { name: "晨光" })).toBeTruthy();
    expect(screen.getByText("这一次，她没有回头")).toBeTruthy();
    expect(screen.getByText("风停了，她也没有再回头。")).toBeTruthy();
  });

  it("收束未到货给占位，到了就换掉占位", () => {
    const { rerender } = render(<EndingCard ending={{ id: "e" }} summaryPending />);
    expect(screen.getByText("剧作家正在写下结局……")).toBeTruthy();

    rerender(<EndingCard ending={{ id: "e" }} summary="真的结束了。" />);
    expect(screen.queryByText("剧作家正在写下结局……")).toBeNull();
    expect(screen.getByText("真的结束了。")).toBeTruthy();
  });

  it("没有按钮：终局卡不是操作面板", () => {
    render(<EndingCard ending={{ id: "e" }} summary="结束。" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
