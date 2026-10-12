// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingJob } from "@aivn/core";
import { PromptQueuePanel, hasPendingWork } from "../src/stage/PromptQueuePanel.js";

afterEach(cleanup);

function job(over: Partial<PendingJob> & Pick<PendingJob, "id" | "kind" | "label">): PendingJob {
  return { startedAt: Date.now(), state: "running", ...over };
}

/**
 * 面板默认收起：点开靠那枚指示符 + 触发器（它的可及名是那行摘要，title 只是提示，故按类名取）。
 * 展开的那块 portal 到 body，触发器则留在原处（面板要锚在它头上），所以断言都收在
 * `panel` 里头——那行摘要两处都写着，不限定范围就会撞在一起。
 */
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
  const panel = document.body.querySelector(".prompt-queue") as HTMLElement;
  return { ...view, panel, onDismissJob };
}

/**
 * pending 面板的失败态：失败项留在面板上、能展开错因、只能按删除键收摊；
 * 收起成徽标时也要一眼看出有失败（那几行不会自己消失）。
 */
describe("PromptQueuePanel 失败项", () => {
  it("收起态：有失败就说「N 项失败」，状态点转成告警色", () => {
    render(
      <PromptQueuePanel
        items={[]}
        jobs={[job({ id: "bg:1", kind: "bg", label: "背景", state: "failed", error: "额度用尽" })]}
        onEdit={() => {}}
        onDelete={() => {}}
        onDismissJob={() => {}}
      />,
    );
    const badge = document.querySelector(".prompt-queue-badge");
    expect(badge?.className).toContain("failed");
    // 收起态是「出事了」唯一看得见的地方：文字要说清几项，点要换成告警色
    expect(badge?.textContent).toContain("失败");
    expect(badge?.querySelector(".status-indicator-dot.is-failed")).not.toBeNull();
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
    const { panel } = openPanel([job({ id: "img:cg:x", kind: "cg", label: "CG cg_x", state: "failed", error: "额度耗尽" })]);
    expect(within(panel).getByText("1 项失败")).toBeTruthy();
    expect(screen.queryByText("额度耗尽")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "看失败原因" }));
    expect(screen.getByText("额度耗尽")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
  });

  it("还在跑的同时有失败：顶行两件事都说，不让失败被「正在生成」盖掉", () => {
    const { panel } = openPanel([
      job({ id: "beat:1", kind: "beat", label: "第 1 轮" }),
      job({ id: "img:bg:x", kind: "bg", label: "背景 rooftop", state: "failed" }),
    ]);
    expect(within(panel).getByText("正在生成 · 1 项失败")).toBeTruthy();
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
describe("dock：工坊里贴内容区底部，不再浮在内容上", () => {
  const renderDocked = (jobs: PendingJob[]) =>
    render(
      <PromptQueuePanel
        items={[]}
        jobs={jobs}
        variant="dock"
        onEdit={() => {}}
        onDelete={() => {}}
        onDismissJob={() => {}}
      />,
    );

  it("收起态与展开态都带贴底类（定位交给 CSS，两边各一份根元素）", () => {
    const view = renderDocked([job({ id: "img:sprite:cat/smile", kind: "sprite", label: "立绘 cat/smile" })]);
    const badge = view.container.querySelector(".prompt-queue-badge");
    expect(badge?.classList.contains("prompt-queue-docked")).toBe(true);
    fireEvent.click(badge!);
    expect(view.container.querySelector(".prompt-queue")?.classList.contains("prompt-queue-docked")).toBe(true);
  });
});

/**
 * dialog：舞台那一份长在台词条底缘那一格状态位里，展开的面板挂到 body 上。
 * 两件都容易在后续改动里悄悄丢掉，各钉一条。
 */
describe("dialog：台词条底缘那枚触发器", () => {
  const renderDialog = (jobs: PendingJob[]) =>
    render(
      <PromptQueuePanel
        items={[]}
        jobs={jobs}
        onEdit={() => {}}
        onDelete={() => {}}
        onDismissJob={() => {}}
      />,
    );

  it("触发器点一下不翻句：台词条整条是「点一下就翻」的热区", () => {
    const onStageClick = vi.fn();
    const view = render(
      <div onClick={onStageClick}>
        <PromptQueuePanel
          items={[]}
          jobs={[job({ id: "beat:1", kind: "beat", label: "第 1 轮" })]}
          onEdit={() => {}}
          onDelete={() => {}}
          onDismissJob={() => {}}
        />
      </div>,
    );
    fireEvent.click(view.container.querySelector(".prompt-queue-badge")!);
    expect(onStageClick).not.toHaveBeenCalled();
  });

  it("展开的面板挂在 body 上，跳出台词条的滚动区与层叠上下文", () => {
    const view = renderDialog([job({ id: "beat:1", kind: "beat", label: "第 1 轮" })]);
    fireEvent.click(view.container.querySelector(".prompt-queue-badge")!);
    expect(view.container.querySelector(".prompt-queue")).toBeNull();
    expect(document.body.querySelector(".prompt-queue")).not.toBeNull();
  });

  it("面板里的点击不冒到舞台：portal 换的是 DOM 落点，React 事件照旧沿逻辑树传", () => {
    const onStageClick = vi.fn();
    const view = render(
      <div onClick={onStageClick}>
        <PromptQueuePanel
          items={[]}
          jobs={[job({ id: "img:cg:x", kind: "cg", label: "CG cg_x", state: "failed", error: "额度用尽" })]}
          onEdit={() => {}}
          onDelete={() => {}}
          onDismissJob={() => {}}
        />
      </div>,
    );
    fireEvent.click(view.container.querySelector(".prompt-queue-badge")!);
    onStageClick.mockClear();
    fireEvent.click(document.body.querySelector(".prompt-queue")!);
    fireEvent.click(screen.getByRole("button", { name: "看失败原因" }));
    fireEvent.click(screen.getByRole("button", { name: "清掉这条" }));
    expect(onStageClick).not.toHaveBeenCalled();
  });

  it("收起键按一下就收摊：trigger 收回台词条里，portal 那块整块撤掉", () => {
    renderDialog([job({ id: "beat:1", kind: "beat", label: "第 1 轮" })]);
    fireEvent.click(document.querySelector(".prompt-queue-badge")!);
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(document.body.querySelector(".prompt-queue")).toBeNull();
    expect(document.querySelector(".prompt-queue-badge")).not.toBeNull();
  });

  it("面板锚在触发器正上方：--chip-x 取它的左沿、--chip-y 换算成离屏幕底的距离", () => {
    // jsdom 里所有 rect 都是 0，这里给触发器一个可控的矩形（真机上是台词条底缘那一格）
    const view = renderDialog([job({ id: "beat:1", kind: "beat", label: "第 1 轮" })]);
    const chip = view.container.querySelector(".prompt-queue-badge") as HTMLElement;
    const rect = (left: number, top: number): DOMRect =>
      ({ left, top, right: left + 80, bottom: top + 16, width: 80, height: 16, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    chip.getBoundingClientRect = () => rect(120, window.innerHeight - 60);
    fireEvent.click(chip);
    let panel = document.body.querySelector(".prompt-queue") as HTMLElement;
    expect(panel.style.getPropertyValue("--chip-x")).toBe("120px");
    expect(panel.style.getPropertyValue("--chip-y")).toBe("68px");

    // 视口变高（台词条自己会随台词变长，窄屏还能内部滚动）：面板得跟着重量
    chip.getBoundingClientRect = () => rect(120, window.innerHeight - 200);
    fireEvent(window, new Event("resize"));
    panel = document.body.querySelector(".prompt-queue") as HTMLElement;
    expect(panel.style.getPropertyValue("--chip-y")).toBe("208px");
  });

  it("没有活儿可报时整块不渲染，宿主据此把那格状态位还给 spinner", () => {
    const view = renderDialog([]);
    expect(view.container.querySelector(".prompt-queue-badge")).toBeNull();
    expect(hasPendingWork([], [])).toBe(false);
    expect(hasPendingWork([], [job({ id: "beat:1", kind: "beat", label: "第 1 轮" })])).toBe(true);
  });
});
