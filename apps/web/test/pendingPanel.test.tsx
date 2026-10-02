// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingJob } from "@stage-ai/core";
import { PromptQueuePanel } from "../src/stage/PromptQueuePanel.js";

afterEach(cleanup);

function job(over: Partial<PendingJob> & Pick<PendingJob, "id" | "kind" | "label">): PendingJob {
  return { startedAt: Date.now(), state: "running", ...over };
}

/** 面板默认收起：点开靠那枚徽标按钮（它的可及名是计数，title 只是提示，故按类名取）。 */
function openPanel(jobs: PendingJob[], onDismissJob = vi.fn()) {
  const view = render(
    <PromptQueuePanel
      items={[]}
      jobs={jobs}
      onEdit={() => {}}
      onDelete={() => {}}
      onDismissJob={onDismissJob}
    />,
  );
  const badge = view.container.querySelector(".prompt-queue-badge");
  if (badge) fireEvent.click(badge);
  return { ...view, onDismissJob };
}

/**
 * pending 面板的失败态：失败项留在面板上、能展开错因、只能按删除键收摊；
 * 收起成徽标时也要一眼看出有失败（那几行不会自己消失）。
 */
describe("PromptQueuePanel 失败项", () => {
  it("收起态：有失败就上警号图标，徽标也标成 failed", () => {
    const view = render(
      <PromptQueuePanel
        items={[]}
        jobs={[job({ id: "img:cg:x", kind: "cg", label: "CG cg_x", state: "failed" })]}
        onEdit={() => {}}
        onDelete={() => {}}
        onDismissJob={() => {}}
      />,
    );
    const badge = view.container.querySelector(".prompt-queue-badge");
    expect(badge?.className).toContain("failed");
    // 收起时是「出事了」的唯一线索，徽标得自己认得出来
    expect(badge?.querySelector(".lucide-triangle-alert")).not.toBeNull();
    expect(badge?.textContent).toContain("1");
  });

  it("没有失败项时徽标照旧：只报在忙的几类，不挂警号", () => {
    render(
      <PromptQueuePanel
        items={[]}
        jobs={[job({ id: "beat:1", kind: "beat", label: "第 1 轮" })]}
        onEdit={() => {}}
        onDelete={() => {}}
        onDismissJob={() => {}}
      />,
    );
    const badge = document.querySelector(".prompt-queue-badge");
    expect(badge?.className).not.toContain("failed");
    expect(badge?.querySelector(".lucide-triangle-alert")).toBeNull();
  });

  it("展开态：失败行默认不铺错因，点开才有；顶上说清挂了几条", () => {
    openPanel([job({ id: "img:cg:x", kind: "cg", label: "CG cg_x", state: "failed", error: "额度耗尽" })]);
    expect(screen.getByText("1 项失败")).toBeTruthy();
    expect(screen.queryByText("额度耗尽")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "看失败原因" }));
    expect(screen.getByText("额度耗尽")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
  });

  it("还在跑的同时有失败：顶行两件事都说，不让失败被「正在生成」盖掉", () => {
    openPanel([
      job({ id: "beat:1", kind: "beat", label: "第 1 轮" }),
      job({ id: "img:bg:x", kind: "bg", label: "背景 rooftop", state: "failed" }),
    ]);
    expect(screen.getByText("正在生成 · 1 项失败")).toBeTruthy();
  });

  it("删除键只长在失败行上，回调的就是那一行的 id", () => {
    const { onDismissJob } = openPanel([
      job({ id: "beat:1", kind: "beat", label: "第 1 轮" }),
      job({ id: "img:sprite:小夜/smile", kind: "sprite", label: "立绘 小夜/smile", state: "failed" }),
    ]);

    // 在跑的那一行没有删除键：只有失败项才是「留着等人处理」的
    const removes = screen.getAllByRole("button", { name: "清掉这条" });
    expect(removes).toHaveLength(1);
    fireEvent.click(removes[0]!);
    expect(onDismissJob).toHaveBeenCalledWith("img:sprite:小夜/smile");
  });

  it("失败项即便没有原因也仍给展开键：不能因为没话可说就查不了", () => {
    openPanel([job({ id: "beat:1", kind: "beat", label: "第 1 轮", state: "failed" })]);
    fireEvent.click(screen.getByRole("button", { name: "看失败原因" }));
    expect(screen.getByText("（没留下原因）")).toBeTruthy();
  });

  it("生图行仍按老样子展开提示词，且没有删除键", () => {
    openPanel([job({ id: "img:cg:x", kind: "cg", label: "CG cg_x", prompt: "黄昏屋顶" })]);
    expect(screen.queryByRole("button", { name: "清掉这条" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "看提示词" }));
    expect(screen.getByText("黄昏屋顶")).toBeTruthy();
  });
});