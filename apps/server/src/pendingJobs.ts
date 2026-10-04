import type { PendingJob } from "@aivn/core";

/** 开一件活儿时给的最小信息；startedAt 与 state 由 tracker 自己定，免得各处传时钟与标志。 */
export type PendingJobStart = Omit<PendingJob, "startedAt" | "state">;

/** 完成态在面板上停留多久（毫秒）：留的是「它刚才完成了」这一眼。 */
const DONE_LINGER_MS = 4000;

/**
 * 收尾函数：不给 error = 干成了（留一会儿再退场）；给了 = 挂了（**不自动退场**）。
 * 重复调用只生效一次——finally 里常见的双路径不该把状态来回横跳。
 */
export type PendingJobFinish = (error?: string) => void;

/**
 * 在生成的事（剧作家的轮次、生图、语音合成）的单一记账处。
 *
 * 面板要回答的是「现在到底在忙什么、等多久了」——工坊 sync 出图、剧作家 queued 预发射、
 * 语音分句合成三条路各自有队列，各自都不知道彼此，光看任何一处都拼不出这张表。
 *
 * 记账方式是「begin 拿一个收尾函数」，调用点写在真正开始干活的地方（不是入队的地方），
 * 所以排队等位的那段时间也会如实显示为等待——生图最耗人的恰恰是排队。
 *
 * 失败项**不自动消失**：自动清掉的失败等于没报过——面板上既看不出出了事，
 * 错因也跟着蒸发。留着的代价是表会越积越长，所以清理只走一条路：面板上手动删（dismiss）。
 */
export class PendingJobs {
  private readonly jobs = new Map<string, PendingJob>();
  /** 完成态的退场计时：留一会儿再删，不删就等于没标记。 */
  private readonly expiries = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emit: (jobs: PendingJob[]) => void,
    private readonly lingerMs = DONE_LINGER_MS,
  ) {}

  /** 记一件活儿；返回收尾函数（重复调用只生效一次）。同名 id 会覆盖，重复生成同一素材即如此。 */
  begin(job: PendingJobStart): PendingJobFinish {
    this.cancelExpiry(job.id);
    const entry: PendingJob = { ...job, state: "running", startedAt: Date.now() };
    this.jobs.set(job.id, entry);
    this.publish();
    let done = false;
    return (error) => {
      if (done) return;
      done = true;
      // 同名条目被新的一遍顶掉了（重复生成同一素材）：这一遍的收尾不许去动它
      if (this.jobs.get(job.id) !== entry) return;
      // 失败项不排退场计时——它要留在面板上等人看过、手动删掉
      if (error !== undefined) {
        this.jobs.set(job.id, { ...entry, state: "failed", error });
        this.publish();
        return;
      }
      if (this.lingerMs <= 0) {
        this.jobs.delete(job.id);
        this.publish();
        return;
      }
      this.jobs.set(job.id, { ...entry, state: "done" });
      this.publish();
      this.expiries.set(
        job.id,
        setTimeout(() => {
          this.expiries.delete(job.id);
          // 同名条目在这一秒里被重新起过一遍，旧计时器不该收走新活
          if (this.jobs.get(job.id)?.state !== "done") return;
          this.jobs.delete(job.id);
          this.publish();
        }, this.lingerMs),
      );
    };
  }

  /**
   * 手动清掉一条（面板上的删除键）。失败项唯一的出路就是这个。
   *
   * 还在跑的条目也放行：删了就是不要了，那件活儿收尾时会对不上号、自行退出（见 begin）。
   */
  dismiss(id: string): void {
    if (!this.jobs.delete(id)) return;
    this.cancelExpiry(id);
    this.publish();
  }

  /** 丢掉某类活儿（如语音总开关关掉时清空全部语音条目）。 */
  clearKind(kind: PendingJob["kind"]): void {
    let changed = false;
    for (const [id, job] of this.jobs) {
      if (job.kind !== kind) continue;
      this.cancelExpiry(id);
      this.jobs.delete(id);
      changed = true;
    }
    if (changed) this.publish();
  }

  /** 整表清空（runtime 被丢弃/重建时）：那些活儿已经没人收尾了，不清就永远挂在面板上。 */
  clearAll(): void {
    if (this.jobs.size === 0) return;
    for (const id of [...this.jobs.keys()]) this.cancelExpiry(id);
    this.jobs.clear();
    this.publish();
  }

  snapshot(): PendingJob[] {
    return [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  private cancelExpiry(id: string): void {
    const timer = this.expiries.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.expiries.delete(id);
  }

  private publish(): void {
    this.emit(this.snapshot());
  }
}

/** 生图类条目的 id：素材目标唯一，重来一次覆盖同一条而不是并排两行。 */
export function jobIdForImage(kind: "bg" | "cg" | "sprite", target: string): string {
  return `img:${kind}:${target}`;
}

/**
 * 音乐类条目的 id：曲子名唯一，与生图同一口径（同名重生成覆盖同一条而不是并排两行）。
 *
 * 前缀 `music:` 而不是 `bgm:` —— 后缀位留给 `img:` 的 kind，词根用可读的 music，
 * 与协议里的 `bgm` 不冲突（那说的是资产类型，这里说的是记账分类）。
 */
export function jobIdForMusic(name: string): string {
  return `music:${name}`;
}

/**
 * 异常取一句话（面板上展开那一行看的就是它，所以不塞堆栈）。
 * 收尾函数收的是字符串而不是异常，各调用点自己拍平——记账这一层不该知道
 * 各家异常长什么样，只该知道「失败的原因是一句话」。
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
