import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingJob } from "@aivn/core";
import { PendingJobs, errorText, jobIdForImage } from "../src/pendingJobs.js";

/** 记账用例一律关掉停留：它们测的是「谁在表里」，不是「在表里待多久」。 */
function tracker(emit: (jobs: PendingJob[]) => void = () => {}): PendingJobs {
  return new PendingJobs(emit, 0);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PendingJobs：在生成的事（右上角面板那一列）", () => {
  it("begin 发一次快照，end 再发一次；同名 id 覆盖而不是并排两行", () => {
    const pushes: number[] = [];
    const jobs = tracker((snapshot) => pushes.push(snapshot.length));
    const done = jobs.begin({ id: "beat:1", kind: "beat", label: "第 1 轮" });
    expect(pushes.at(-1)).toBe(1);
    done();
    expect(pushes.at(-1)).toBe(0);
    done(); // 重复收尾不再发（finally 里常见的双路径）
    expect(pushes.at(-1)).toBe(0);
  });

  it("按入列先后排（同一毫秒内保持入列顺序），结束各归各位", async () => {
    const jobs = tracker();
    const first = jobs.begin({ id: "a", kind: "bg", label: "背景" });
    const sameTick = jobs.begin({ id: "b", kind: "voice", label: "台词" });
    await new Promise((r) => setTimeout(r, 2));
    const last = jobs.begin({ id: "c", kind: "sprite", label: "立绘" });
    expect(jobs.snapshot().map((j) => j.id)).toEqual(["a", "b", "c"]);
    sameTick();
    expect(jobs.snapshot().map((j) => j.id)).toEqual(["a", "c"]);
    first();
    last();
  });

  it("clearAll 清空整表（runtime 被丢弃时那些活儿没人收尾）", () => {
    const jobs = tracker();
    jobs.begin({ id: "beat:1", kind: "beat", label: "第 1 轮" });
    jobs.begin({ id: jobIdForImage("bg", "x"), kind: "bg", label: "背景 x" });
    jobs.clearAll();
    expect(jobs.snapshot()).toEqual([]);
    jobs.clearAll(); // 幂等，空表不再广播
  });

  it("clearKind 只清某一类（语音开关关掉时清语音条目，别的活儿还在跑）", () => {
    const jobs = tracker();
    const bg = jobs.begin({ id: jobIdForImage("bg", "rooftop"), kind: "bg", label: "背景 rooftop" });
    jobs.begin({ id: "voice:7", kind: "voice", label: "第 1 句台词" });
    jobs.clearKind("voice");
    expect(jobs.snapshot().map((j) => j.kind)).toEqual(["bg"]);
    bg();
    expect(jobs.snapshot()).toEqual([]);
  });
});

describe("PendingJobs 完成态", () => {
  it("收尾不是立刻消失：先标 done 留在表里，到点才走", () => {
    vi.useFakeTimers();
    const pushes: (string | null)[] = [];
    const jobs = new PendingJobs((snapshot) => pushes.push(snapshot[0]?.state ?? null));
    const done = jobs.begin({ id: jobIdForImage("cg", "cg_x"), kind: "cg", label: "CG cg_x" });
    expect(jobs.snapshot()[0]?.state).toBe("running");

    done();
    expect(jobs.snapshot()).toHaveLength(1);
    expect(jobs.snapshot()[0]?.state).toBe("done");

    vi.advanceTimersByTime(4000);
    expect(jobs.snapshot()).toEqual([]);
    // 三拍广播：入列、标完成、真删
    expect(pushes).toEqual(["running", "done", null]);
  });

  it("同名条目重新起一遍：旧收尾与旧计时器都不许动它", () => {
    vi.useFakeTimers();
    const jobs = new PendingJobs(() => {}, 3000);
    const first = jobs.begin({ id: jobIdForImage("cg", "same"), kind: "cg", label: "CG same" });
    first();
    expect(jobs.snapshot()[0]?.state).toBe("done");

    jobs.begin({ id: jobIdForImage("cg", "same"), kind: "cg", label: "CG same" });
    vi.advanceTimersByTime(5000); // 旧计时器这一刻到点
    expect(jobs.snapshot()[0]?.state).toBe("running");
  });

  it("clearAll 连同停留计时一起清（清完不该又被计时器推一次广播）", () => {
    vi.useFakeTimers();
    const pushes: number[] = [];
    const jobs = new PendingJobs((snap) => pushes.push(snap.length));
    const done = jobs.begin({ id: "beat:1", kind: "beat", label: "第 1 轮" });
    done();
    jobs.clearAll();
    const after = pushes.length;
    vi.advanceTimersByTime(10_000);
    expect(pushes.length).toBe(after);
    expect(jobs.snapshot()).toEqual([]);
  });
});

describe("PendingJobs 失败态", () => {
  it("给了错因就是失败：留在表里带 error，计时器再久也不收走", () => {
    vi.useFakeTimers();
    const jobs = new PendingJobs(() => {}, 3000);
    const done = jobs.begin({ id: jobIdForImage("cg", "cg_x"), kind: "cg", label: "CG cg_x" });

    done("上游 503：额度耗尽");

    const [entry] = jobs.snapshot();
    expect(entry.state).toBe("failed");
    expect(entry.error).toBe("上游 503：额度耗尽");
    // 完成态那 3 秒过了也不该动它：失败项不排退场计时
    vi.advanceTimersByTime(60_000);
    expect(jobs.snapshot()).toEqual([entry]);
  });

  it("失败项同名重新起一遍会顶掉旧的（重试过一次就不该留两条同名的失败）", () => {
    const jobs = tracker();
    const first = jobs.begin({ id: jobIdForImage("cg", "same"), kind: "cg", label: "CG same" });
    first("第一次挂了");
    expect(jobs.snapshot()[0]?.error).toBe("第一次挂了");

    const retry = jobs.begin({ id: jobIdForImage("cg", "same"), kind: "cg", label: "CG same" });
    expect(jobs.snapshot()).toHaveLength(1);
    expect(jobs.snapshot()[0]?.state).toBe("running");

    // 旧那一遍的收尾再补一刀也不许把新活改成失败
    first("迟到的错因");
    expect(jobs.snapshot()[0]?.state).toBe("running");
    retry();
  });

  it("dismiss 清掉一条失败项并广播；清一条不存在的 id 不广播", () => {
    const pushes: number[] = [];
    const jobs = new PendingJobs((snap) => pushes.push(snap.length));
    jobs.begin({ id: jobIdForImage("bg", "rooftop"), kind: "bg", label: "背景 rooftop" })("挂了");
    const afterSetup = pushes.length;
    expect(pushes.at(-1)).toBe(1);

    jobs.dismiss("不存在的条目");
    expect(pushes.length).toBe(afterSetup);

    jobs.dismiss(jobIdForImage("bg", "rooftop"));
    expect(jobs.snapshot()).toEqual([]);
    expect(pushes.at(-1)).toBe(0);
  });

  it("dismiss 掉还在跑的条目：那件活儿后来收尾时对不上号，自行退出且不再广播", () => {
    const pushes: number[] = [];
    const jobs = new PendingJobs((snap) => pushes.push(snap.length));
    const done = jobs.begin({ id: jobIdForImage("sprite", "小夜/smile"), kind: "sprite", label: "立绘" });

    jobs.dismiss(jobIdForImage("sprite", "小夜/smile"));
    const after = pushes.length;

    done();
    expect(pushes.length).toBe(after);
    expect(jobs.snapshot()).toEqual([]);
  });

  it("errorText 把异常拍平成一句话（非 Error 也不丢）", () => {
    expect(errorText(new Error("上游 503"))).toBe("上游 503");
    expect(errorText("字符串错因")).toBe("字符串错因");
  });
});