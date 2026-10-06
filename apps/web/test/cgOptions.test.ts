import { describe, expect, it } from "vitest";
import { cgCanSubmit, toggleReference } from "@aivn/stage";

describe("cgOptions", () => {
  describe("toggleReference", () => {
    it("未选中时加入末尾（保留先后顺序）", () => {
      let selected: string[] = [];
      selected = toggleReference(selected, "koharu");
      expect(selected).toEqual(["koharu"]);

      selected = toggleReference(selected, "hero");
      expect(selected).toEqual(["koharu", "hero"]);

      selected = toggleReference(selected, "sensei");
      expect(selected).toEqual(["koharu", "hero", "sensei"]);
    });

    it("已选中时移除", () => {
      const selected = ["koharu", "hero", "sensei"];
      expect(toggleReference(selected, "hero")).toEqual(["koharu", "sensei"]);
      expect(toggleReference(selected, "koharu")).toEqual(["hero", "sensei"]);
    });
  });

  describe("cgCanSubmit", () => {
    it("勾选基于历史时：指令可填也可留空", () => {
      expect(cgCanSubmit("", true)).toBe(true);
      expect(cgCanSubmit("   ", true)).toBe(true);
      expect(cgCanSubmit("特写", true)).toBe(true);
    });

    it("取消基于历史时：必须填写指令", () => {
      expect(cgCanSubmit("", false)).toBe(false);
      expect(cgCanSubmit("   ", false)).toBe(false);
      expect(cgCanSubmit("夕阳下的背影", false)).toBe(true);
    });
  });
});
