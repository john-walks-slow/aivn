import { describe, expect, it } from "vitest";
import { LineageTree, lineageToEvents, toNodeView } from "../src/index.js";

const toNode = toNodeView;

/** 重放链上的 scene 事件（按 attrs 过滤），音频属性的回归线全盯这个。 */
function scenes(tree: LineageTree, fromLeaf?: string): Record<string, string | number>[] {
  return lineageToEvents(tree.materialize(fromLeaf).map(toNode))
    .filter((e) => e.event.kind === "scene")
    .map((e) => e.event as Record<string, string | number>);
}

describe("谱系重放：音频属性", () => {
  it("scene 的音量属性要跟着重放回去（bgm_volume / ambient_volume）", () => {
    const tree = new LineageTree();
    tree.append("scene", {
      payload: { attrs: { bg: "hall", bgm: "piano", bgm_volume: "0.4", ambient: "rain", ambient_volume: "0.2" } },
    });
    expect(scenes(tree)[0]).toMatchObject({
      bg: "hall",
      bgm: "piano",
      bgm_volume: 0.4,
      ambient: "rain",
      ambient_volume: 0.2,
    });
  });

  it("缺省与「显式停止」必须分得开：没写就不带键，写 none 就带 none", () => {
    const tree = new LineageTree();
    tree.append("scene", { payload: { attrs: { bg: "hall" } } });
    tree.append("scene", { payload: { attrs: { bg: "hall", bgm: "none" } } });
    const [first, second] = scenes(tree);
    // 第一个：属性缺省 = 保持当前，重放出来的键必须不存在
    expect("bgm" in first!).toBe(false);
    // 第二个：显式停止，重放必须还原成 none，客户端才停得下来
    expect(second!.bgm).toBe("none");
  });

  it("sfx 的 volume 要跟着重放回去", () => {
    const tree = new LineageTree();
    tree.append("sfx", { payload: { attrs: { src: "door", volume: "0.35" } } });
    tree.append("sfx", { payload: { attrs: { src: "door" } } });
    const sfx = lineageToEvents(tree.materialize().map(toNode))
      .filter((e) => e.event.kind === "sfx")
      .map((e) => e.event as Record<string, number>);
    expect(sfx[0]!.volume).toBe(0.35);
    expect("volume" in sfx[1]!).toBe(false);
  });

  it("非数字的音量不进事件流（不能变成 NaN 传到客户端）", () => {
    const tree = new LineageTree();
    tree.append("scene", { payload: { attrs: { bgm: "piano", bgm_volume: "大声" } } });
    expect(scenes(tree)[0]).toMatchObject({ bgm: "piano" });
    expect("bgm_volume" in scenes(tree)[0]!).toBe(false);
  });

  it("空串音量按缺省放过（Number(\"\") 是 0，会把音量打到静音）", () => {
    const tree = new LineageTree();
    tree.append("scene", { payload: { attrs: { bgm: "piano", bgm_volume: "   " } } });
    tree.append("sfx", { payload: { attrs: { src: "door", volume: "" } } });
    expect("bgm_volume" in scenes(tree)[0]!).toBe(false);
    const sfx = lineageToEvents(tree.materialize().map(toNode)).find((e) => e.event.kind === "sfx")!;
    expect("volume" in sfx.event).toBe(false);
  });

  it("分岔后重放的是新分支那条链，音量跟着分支走", () => {
    const tree = new LineageTree();
    tree.append("scene", { payload: { attrs: { bg: "hall", bgm_volume: "0.3" } } });
    const fork = tree.append("scene", { payload: { attrs: { bg: "hall", bgm_volume: "0.9" } } });
    // 链上的最后一条 scene 才是当前生效的：原分支到第一处，新分支到第二处
    expect(scenes(tree, fork.id).at(-1)!.bgm_volume).toBe(0.9);
    expect(scenes(tree, tree.leafId).at(-1)!.bgm_volume).toBe(0.9);
    expect(scenes(tree).length).toBe(2);
  });
});
