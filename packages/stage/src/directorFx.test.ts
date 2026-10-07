import { describe, expect, it } from "vitest";
import { applyFxCue, applyVisualCue, type VisualState } from "./director.js";
import type { Cue } from "./script.js";

const visual = (partial: Partial<VisualState> = {}): VisualState => ({
  bg: null,
  bgm: null,
  ambient: null,
  bgTransition: null,
  fx: { camera: {}, screen: {} },
  cg: null,
  sprites: {},
  pending: {},
  ...partial,
});

const fx = (
  cue: Omit<Extract<Cue, { kind: "fx" }>, "key" | "kind">,
): Extract<Cue, { kind: "fx" }> => ({ key: "k", kind: "fx", ...cue });

describe("applyFxCue：trigger（演一次，靠 seq 重播）", () => {
  it("flash 每次 seq +1", () => {
    let v = applyFxCue(visual(), fx({ effect: "flash", verb: "trigger", value: "red" }));
    expect(v.fx.screen.flash).toEqual({ value: "red", seq: 1, on: false });
    v = applyFxCue(v, fx({ effect: "flash", verb: "trigger", value: "white" }));
    expect(v.fx.screen.flash).toEqual({ value: "white", seq: 2, on: false });
  });

  it("shake 落在 camera 上", () => {
    const v = applyFxCue(visual(), fx({ effect: "shake", verb: "trigger", value: "heavy" }));
    expect(v.fx.camera.shake).toEqual({ value: "heavy", seq: 1, on: false });
  });
});

describe("applyFxCue：on/off（持续开关）", () => {
  it("shake 可以持续抖并停", () => {
    let v = applyFxCue(visual(), fx({ effect: "shake", verb: "on", value: "heavy" }));
    expect(v.fx.camera.shake).toEqual({ value: "heavy", seq: 0, on: true });
    v = applyFxCue(v, fx({ effect: "shake", verb: "off" }));
    expect(v.fx.camera.shake).toEqual({ value: "heavy", seq: 0, on: false });
  });

  it("flash 可以常亮并撤掉", () => {
    let v = applyFxCue(visual(), fx({ effect: "flash", verb: "on", value: "red" }));
    expect(v.fx.screen.flash).toEqual({ value: "red", seq: 0, on: true });
    v = applyFxCue(v, fx({ effect: "flash", verb: "off" }));
    expect(v.fx.screen.flash).toEqual({ value: "red", seq: 0, on: false });
  });

  it("letterbox / vignette 各自独立开关", () => {
    let v = applyFxCue(visual(), fx({ effect: "letterbox", verb: "on" }));
    v = applyFxCue(v, fx({ effect: "vignette", verb: "on" }));
    expect(v.fx.screen.letterbox).toEqual({ value: "", seq: 0, on: true });
    expect(v.fx.screen.vignette).toEqual({ value: "", seq: 0, on: true });
    v = applyFxCue(v, fx({ effect: "letterbox", verb: "off" }));
    expect(v.fx.screen.letterbox?.on).toBe(false);
    expect(v.fx.screen.vignette?.on).toBe(true);
  });
});

describe("换层过渡 (dual-source，仅背景)", () => {
  it("首次换底：from=null，seq=1，缺省 fade", () => {
    const v = applyVisualCue(visual(), { key: "k", kind: "scene", bg: "rooftop" });
    expect(v.bgTransition).toEqual({ name: "fade", seq: 1, from: null });
  });

  it("再次换底：from 指向旧背景，seq 递增，认剧本给的转场", () => {
    let v = applyVisualCue(visual(), { key: "k", kind: "scene", bg: "rooftop" });
    v = applyVisualCue(v, { key: "k2", kind: "scene", bg: "classroom", transition: "cut" });
    expect(v.bgTransition).toEqual({ name: "cut", seq: 2, from: "rooftop" });
  });

  it("只改 BGM（bg 不变）不播过渡", () => {
    let v = applyVisualCue(visual(), { key: "k", kind: "scene", bg: "rooftop" });
    const before = v.bgTransition;
    v = applyVisualCue(v, { key: "k2", kind: "scene", bgm: "piano" });
    expect(v.bgTransition).toBe(before);
  });

  it("换景即离开 CG", () => {
    let v = applyVisualCue(visual(), { key: "k", kind: "cg", id: "c1" });
    expect(v.cg).toEqual({ id: "c1", caption: undefined });
    v = applyVisualCue(v, { key: "k2", kind: "scene", bg: "rooftop" });
    expect(v.cg).toBeNull();
  });
});
