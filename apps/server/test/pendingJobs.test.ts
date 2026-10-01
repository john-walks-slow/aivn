import { describe, expect, it } from "vitest";
import { PendingJobs, jobIdForImage } from "../src/pendingJobs.js";

describe("PendingJobs：在生成的事（右上角面板那一列）", () => {
  it("begin 发一次快照，end 再发一次；同名 id 覆盖而不是并排两行", () => {
    const pushes: number[] = [];
    const jobs = new PendingJobs((snapshot) => pushes.push(snapshot.length));
    const done = jobs.begin({ id: "beat:1", kind: "beat", label: "第 1 轮" });
    expect(pushes.at(-1)).toBe(1);
    done();
    expect(pushes.at(-1)).toBe(0);
    done(); // 重复收尾不再发（finally 里常见的双路径）
    expect(pushes.at(-1)).toBe(0);
  });

  it("按入列先后排（同一毫秒内保持入列顺序），结束各归各位", async () => {
    const jobs = new PendingJobs(() => {});
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
    const jobs = new PendingJobs(() => {});
    jobs.begin({ id: "beat:1", kind: "beat", label: "第 1 轮" });
    jobs.begin({ id: jobIdForImage("bg", "x"), kind: "bg", label: "背景 x" });
    jobs.clearAll();
    expect(jobs.snapshot()).toEqual([]);
    jobs.clearAll(); // 幂等，空表不再广播
  });

  it("clearKind 只清某一类（语音开关关掉时清语音条目，别的活儿还在跑）", () => {
    const jobs = new PendingJobs(() => {});
    const bg = jobs.begin({ id: jobIdForImage("bg", "rooftop"), kind: "bg", label: "背景 rooftop" });
    jobs.begin({ id: "voice:7", kind: "voice", label: "第 1 句台词" });
    jobs.clearKind("voice");
    expect(jobs.snapshot().map((j) => j.kind)).toEqual(["bg"]);
    bg();
    expect(jobs.snapshot()).toEqual([]);
  });
});
