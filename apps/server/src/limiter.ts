/**
 * 并发闸门（生图铁律⑥）：槽位**直接转让**给 waiter，`running` 不动。
 *
 * 为什么不能先减 `running` 再给 waiter：释放与新请求之间隔着微任务间隙，
 * 那时新请求会看到空位直接进来，与被唤醒的 waiter 重叠——`max=1` 就能并发跑两张。
 * 先减后发的写法实测会排出 `+a -a +b +c -b -c` 的重叠序列。
 *
 * 优先级：playwriter 预发射为 high，工坊生图为 normal。工坊是人在等的串行对话，
 * 一批能占满闸门几十秒；预发射虽不 await（铁律①），被挤到队尾就等于失去意义。
 * 同优先级先进先出，且新人不能插队同级的既有 waiter。
 */
export type JobPriority = "high" | "normal";

interface Waiter {
  priority: JobPriority;
  grant: () => void;
}

const RANK: Record<JobPriority, number> = { high: 1, normal: 0 };

/** 排队上限：预发射与工坊出图都是「锦上添花」，队列爆掉直接失败降级，不无限吃内存。 */
export const DEFAULT_MAX_QUEUE = 12;

export class Limiter {
  private running = 0;
  private queue: Waiter[] = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number = DEFAULT_MAX_QUEUE,
    /** 队列爆掉时的错误前缀（要能被玩家看懂，故传业务名而非硬编码）。 */
    private readonly label = "生图",
  ) {}

  async run<T>(fn: () => Promise<T>, priority: JobPriority = "normal"): Promise<T> {
    // 取槽必须在 try 之外：队列满时这里抛出，若被 finally 的 release 接住会凭空发出一个槽
    await this.acquire(priority);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 当前在跑的任务数（测试与诊断用）。 */
  get active(): number {
    return this.running;
  }

  private acquire(priority: JobPriority): Promise<void> {
    if (this.running < this.max && !this.queuedAhead(priority)) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new Error(`${this.label}队列已满`));
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ priority, grant: resolve });
    });
  }

  /** 队列里有优先级不低于自己的 waiter 时不能插队。 */
  private queuedAhead(priority: JobPriority): boolean {
    const rank = RANK[priority];
    return this.queue.some((w) => RANK[w.priority] >= rank);
  }

  private release(): void {
    const next = this.takeNext();
    if (next) next.grant(); // 槽位直接转让，running 保持不变
    else this.running -= 1;
  }

  /** 取最高优先级、同级最老的 waiter。 */
  private takeNext(): Waiter | null {
    if (this.queue.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.queue.length; i += 1) {
      if (RANK[this.queue[i]!.priority] > RANK[this.queue[best]!.priority]) best = i;
    }
    return this.queue.splice(best, 1)[0] ?? null;
  }
}
