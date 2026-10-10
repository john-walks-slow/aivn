import { describe, expect, it } from "vitest";
import { helloSync } from "./helloSync.js";

describe("helloSync：单树 epoch 同步", () => {
  it("首屏只认 epoch，不判结构替换", () => {
    const plan = helloSync({ seen: false, epoch: 0, helloEpoch: 3 });
    expect(plan).toMatchObject({ restamped: false, adoptedEpoch: 3 });
  });

  it("同一代号重连不作废缓冲", () => {
    const plan = helloSync({ seen: true, epoch: 2, helloEpoch: 2 });
    expect(plan).toMatchObject({ restamped: false });
  });

  it("分岔/重写代号变化时整段重放", () => {
    const plan = helloSync({ seen: true, epoch: 2, helloEpoch: 3 });
    expect(plan).toMatchObject({ restamped: true });
  });
});
