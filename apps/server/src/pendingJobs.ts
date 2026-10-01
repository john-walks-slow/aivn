import type { PendingJob } from "@stage-ai/core";

/** 开一件活儿时给的最小信息；startedAt 由 tracker 自己记，免得各处传时钟。 */
export type PendingJobStart = Omit<PendingJob, "startedAt">;

/**
 * 在生成的事（剧作家的轮次、生图、语音合成）的单一记账处。
 *
 * 面板要回答的是「现在到底在忙什么、等多久了」——工坊 sync 出图、剧作家 queued 预发射、
 * 语音分句合成三条路各自有队列，各自都不知道彼此，光看任何一处都拼不出这张表。
 *
 * 记账方式是「begin 拿一个收尾函数」，调用点写在真正开始干活的地方（不是入队的地方），
 * 所以排队等位的那段时间也会如实显示为等待——生图最耗人的恰恰是排队。
 */
export class PendingJobs {
  private readonly jobs = new Map<string, PendingJob>();

  constructor(private readonly emit: (jobs: PendingJob[]) => void) {}

  /** 记一件活儿；返回收尾函数（重复调用只生效一次）。同名 id 会覆盖，重复生成同一素材即如此。 */
  begin(job: PendingJobStart): () => void {
    this.jobs.set(job.id, { ...job, startedAt: Date.now() });
    this.publish();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.jobs.delete(job.id);
      this.publish();
    };
  }

  /** 丢掉某类活儿（如语音总开关关掉时清空全部语音条目）。 */
  clearKind(kind: PendingJob["kind"]): void {
    let changed = false;
    for (const [id, job] of this.jobs) {
      if (job.kind !== kind) continue;
      this.jobs.delete(id);
      changed = true;
    }
    if (changed) this.publish();
  }

  /** 整表清空（runtime 被丢弃/重建时）：那些活儿已经没人收尾了，不清就永远挂在面板上。 */
  clearAll(): void {
    if (this.jobs.size === 0) return;
    this.jobs.clear();
    this.publish();
  }

  snapshot(): PendingJob[] {
    return [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  private publish(): void {
    this.emit(this.snapshot());
  }
}

/** 生图类条目的 id：素材目标唯一，重来一次覆盖同一条而不是并排两行。 */
export function jobIdForImage(kind: "bg" | "cg" | "sprite", target: string): string {
  return `img:${kind}:${target}`;
}
