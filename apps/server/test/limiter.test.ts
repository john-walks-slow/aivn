import { describe, expect, it } from "vitest";
import { Limiter } from "../src/limiter.js";

/** 让出一个微任务间隙——槽位转让写错（先减 running 再唤醒）正是在这个间隙里露馅的。 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 记录「谁进来 / 谁出去」的时序。正确的闸门必须得到严格不重叠的 `+a -a +b -c` 型序列；
 * 先减后发的写法会排出 `+a -a +b +c -b -c`（max=1 也并发 2 个）。
 */
function tracker(): { start: (id: string) => () => void; log: string[] } {
  const log: string[] = [];
  return {
    log,
    start: (id: string) => {
      log.push(`+${id}`);
      return () => log.push(`-${id}`);
    },
  };
}

describe("Limiter：并发闸门", () => {
  it("max=1 严格串行：任何时刻只有一个任务在跑", async () => {
    const limiter = new Limiter(1);
    const { start, log } = tracker();
    const job = (id: string, ms: number): Promise<void> =>
      limiter.run(async () => {
        const stop = start(id);
        await new Promise((r) => setTimeout(r, ms));
        stop();
      });
    await Promise.all([job("a", 5), job("b", 1), job("c", 1)]);
    expect(log).toEqual(["+a", "-a", "+b", "-b", "+c", "-c"]);
  });

  it("槽位直接转让给 waiter：新任务不能插空（对轮序列）", async () => {
    const limiter = new Limiter(1);
    const { start, log } = tracker();
    const first = limiter.run(async () => {
      log.push("+a");
      await tick();
      log.push("-a");
    });
    await tick();
    // 队列里已有 b；此时 a 释放若先把 running 减到 0，后到的 c 会直接进闸门
    const b = limiter.run(async () => {
      log.push("+b");
      await tick();
      log.push("-b");
    });
    await tick();
    const c = limiter.run(async () => {
      log.push("+c");
      await tick();
      log.push("-c");
    });
    await Promise.all([first, b, c]);
    expect(log).toEqual(["+a", "-a", "+b", "-b", "+c", "-c"]);
  });

  it("不超发：同一时刻的活跃数不超过 max", async () => {
    const limiter = new Limiter(2);
    let live = 0;
    let peak = 0;
    await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        limiter.run(async () => {
          live += 1;
          peak = Math.max(peak, live);
          await new Promise((r) => setTimeout(r, 5));
          live -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(limiter.active).toBe(0);
  });

  it("high 优先：预发射插到工坊队列前面", async () => {
    const limiter = new Limiter(1);
    const order: string[] = [];
    const hold = limiter.run(async () => {
      order.push("hold");
      await new Promise((r) => setTimeout(r, 10));
    });
    await tick();
    const normal1 = limiter.run(async () => void order.push("normal1"));
    const normal2 = limiter.run(async () => void order.push("normal2"));
    const high = limiter.run(async () => void order.push("high"), "high");
    await Promise.all([hold, normal1, normal2, high]);
    expect(order).toEqual(["hold", "high", "normal1", "normal2"]);
  });

  it("同级先进先出，且新人不能插同级的队", async () => {
    const limiter = new Limiter(1);
    const order: string[] = [];
    const hold = limiter.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await tick();
    const first = limiter.run(async () => void order.push("first"));
    const second = limiter.run(async () => void order.push("second"));
    const late = limiter.run(async () => void order.push("late"));
    await Promise.all([hold, first, second, late]);
    expect(order).toEqual(["first", "second", "late"]);
  });

  it("队列爆掉直接报错，不无限吃内存", async () => {
    const limiter = new Limiter(1, 2, "生图");
    const hold = limiter.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const q1 = limiter.run(async () => {});
    const q2 = limiter.run(async () => {});
    await expect(limiter.run(async () => {})).rejects.toThrow("生图队列已满");
    await Promise.all([hold, q1, q2]);
  });

  it("取槽失败不释放槽位（acquire 在 try 之外）", async () => {
    const limiter = new Limiter(1, 1);
    const hold = limiter.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const queued = limiter.run(async () => {});
    await expect(limiter.run(async () => {})).rejects.toThrow();
    // 爆掉的那个请求若错误地 release 过，hold 结束后闸门会认为还有空位而放行一个不存在的任务
    expect(limiter.active).toBe(1);
    await Promise.all([hold, queued]);
    expect(limiter.active).toBe(0);
  });

  it("任务抛错也释放槽位", async () => {
    const limiter = new Limiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error("网关 503");
      }),
    ).rejects.toThrow("网关 503");
    expect(limiter.active).toBe(0);
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});
