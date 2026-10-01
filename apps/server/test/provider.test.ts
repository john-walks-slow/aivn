import { describe, expect, it } from "vitest";
import { supportedModels, type GatewayModel } from "../src/provider.js";

const GATEWAY: GatewayModel[] = [
  { id: "high", name: "high" },
  { id: "low", name: "low" },
  { id: "vision", name: "vision" },
];

describe("支持清单收窄网关模型清单", () => {
  it("不配清单：网关全量原样放行（老行为不变）", () => {
    expect(supportedModels(GATEWAY, [])).toBe(GATEWAY);
  });

  it("配了清单：只留点名的，且按配置里的顺序排（不是字母序）", () => {
    expect(supportedModels(GATEWAY, ["vision", "low"]).map((m) => m.id)).toEqual(["vision", "low"]);
  });

  it("清单里的 id 网关没有：点名报错，不静默丢（下拉里摆一个发不出去的模型更坑）", () => {
    expect(() => supportedModels(GATEWAY, ["low", "gpt-9"])).toThrow(/gpt-9/);
  });
});