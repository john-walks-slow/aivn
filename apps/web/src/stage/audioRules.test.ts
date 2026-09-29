import { describe, expect, it } from "vitest";
import { resolveAudio } from "./director.js";

/**
 * 音轨三态：换景不换乐、显式 none 才停。
 * 之前 `bgm: cue.bgm ?? null` 让每个没写 bgm 的场景都把音乐掐了——这条规则钉死它。
 */
describe("resolveAudio：scene 音轨属性", () => {
  it("缺省是保持当前，不是停", () => {
    expect(resolveAudio("twilight", undefined)).toBe("twilight");
  });

  it("显式 none / 空串 / 大写 NONE 都是停", () => {
    expect(resolveAudio("twilight", "none")).toBeNull();
    expect(resolveAudio("twilight", "NONE")).toBeNull();
    expect(resolveAudio("twilight", " ")).toBeNull();
  });

  it("给新 id 就是换曲", () => {
    expect(resolveAudio("twilight", "rain")).toBe("rain");
    expect(resolveAudio(null, "rain")).toBe("rain");
  });

  it("停过一次之后，缺省不会自己回来", () => {
    expect(resolveAudio(null, undefined)).toBeNull();
  });
});
