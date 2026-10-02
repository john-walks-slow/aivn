import { describe, expect, it } from "vitest";
import { helloSync } from "./helloSync.js";

describe("helloSync：首屏 vs 真的换代", () => {
  it("首屏：服务端的 saveId/epoch 与本地初值不一样也不算换代（否则刷新即丢阅读位置）", () => {
    const plan = helloSync({
      seen: false,
      saveId: null,
      helloSaveId: "smuqso1yj",
      epoch: 0,
      helloEpoch: 3,
    });
    expect(plan.switched).toBe(false);
    expect(plan.restamped).toBe(false);
    expect(plan.adoptedSaveId).toBe("smuqso1yj");
    expect(plan.adoptedEpoch).toBe(3);
  });

  it("真换代：重连后报的还是同一棵树同一代号，什么都不作废", () => {
    const plan = helloSync({ seen: true, saveId: "a", helloSaveId: "a", epoch: 2, helloEpoch: 2 });
    expect(plan).toMatchObject({ switched: false, restamped: false });
  });

  it("分岔/重写：代号变了 → 整段重放，但阅读位置要留着之外的路径另算（本例随换代作废）", () => {
    const plan = helloSync({ seen: true, saveId: "a", helloSaveId: "a", epoch: 2, helloEpoch: 3 });
    expect(plan.restamped).toBe(true);
    expect(plan.switched).toBe(false);
  });

  it("换周目：saveId 变了就不再报换代（seq 已随树作废，再报一次只会多放一遍）", () => {
    const plan = helloSync({ seen: true, saveId: "a", helloSaveId: "b", epoch: 2, helloEpoch: 9 });
    expect(plan.switched).toBe(true);
    expect(plan.restamped).toBe(false);
  });
});
