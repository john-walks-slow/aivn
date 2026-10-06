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
  partial: Partial<Extract<Cue, { kind: "fx" }>> & { target: Extract<Cue, { kind: "fx" }>["target"] },
): Extract<Cue, { kind: "fx" }> => ({ key: "k", kind: "fx", ...partial });

describe("applyFxCue：一次性效果 (trigger)", () => {
  it("flash 每次 seq +1（连写两次要能重播）", () => {
    let v = applyFxCue(visual(), fx({ target: "screen", effect: "flash", value: "red" }));
    expect(v.fx.screen.flash).toEqual({ value: "red", seq: 1 });
    v = applyFxCue(v, fx({ target: "screen", effect: "flash", value: "white" }));
    expect(v.fx.screen.flash).toEqual({ value: "white", seq: 2 });
  });

  it("shake 落在 camera 上", () => {
    const v = applyFxCue(visual(), fx({ target: "camera", effect: "shake", value: "heavy" }));
    expect(v.fx.camera.shake).toEqual({ value: "heavy", seq: 1 });
  });
});

describe("applyFxCue：持续效果 (state) 与 release", () => {
  it("letterbox / vignette 落在 screen", () => {
    let v = applyFxCue(visual(), fx({ target: "screen", effect: "letterbox", value: "on" }));
    v = applyFxCue(v, fx({ target: "screen", effect: "vignette", value: "on" }));
    expect(v.fx.screen.letterbox).toBe(true);
    expect(v.fx.screen.vignette).toBe(true);
    v = applyFxCue(v, fx({ target: "screen", effect: "letterbox", value: "off" }));
    expect(v.fx.screen.letterbox).toBe(false);
  });

  it("release 清空该 target 的持续效果，不影响别的 target", () => {
    let v = applyFxCue(visual(), fx({ target: "camera", effect: "shake", value: "light" }));
    v = applyFxCue(v, fx({ target: "screen", effect: "letterbox", value: "on" }));
    v = applyFxCue(v, fx({ target: "screen", effect: "vignette", value: "on" }));
    v = applyFxCue(v, fx({ target: "screen", release: true }));
    expect(v.fx.screen).toEqual({});
    expect(v.fx.camera.shake).toEqual({ value: "light", seq: 1 });
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
