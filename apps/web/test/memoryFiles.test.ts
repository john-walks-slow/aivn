import { describe, expect, it } from "vitest";
import { memorySections } from "../src/workshop/memoryFiles.js";
import type { PlayFile } from "../src/api.js";

const file = (path: string, writable = true): PlayFile => ({
  path,
  dir: path.split("/").slice(0, -1),
  size: 10,
  writable,
  kind: "text",
});

/**
 * 记忆页（工坊「记忆」tab）：把 memory/** 按「剧作家怎么用」分组，
 * 而不是照抄目录树——arcs/archive 是纪元压缩的机器产物，混在可编辑卡里迟早被手改坏。
 */
describe("记忆页分组", () => {
  it("只收 memory/**：play.json 与素材不是记忆", () => {
    const groups = memorySections([file("play.json"), file("assets/bg/a.png", false)]);
    expect(groups).toEqual([]);
  });

  it("常驻 → 角色 → 设定卡 → 只读产物，四组按这个顺序", () => {
    const groups = memorySections([
      file("memory/index/lore/school.md"),
      file("memory/always/premise.md"),
      file("memory/arcs/arc-3.md", false),
      file("memory/always/characters/koharu.md"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(["always", "characters", "index", "derived"]);
  });

  it("arcs / archive 归只读产物：剧目记忆的机器产物，手改会绕过按分支过滤的防剧透", () => {
    const [derived] = memorySections([file("memory/arcs/arc-1.md"), file("memory/archive/events.jsonl", false)]);
    expect(derived.readOnly).toBe(true);
    expect(derived.files.map((f) => f.path)).toEqual([
      "memory/arcs/arc-1.md",
      "memory/archive/events.jsonl",
    ]);
  });

  it("可编辑组跟随服务端白名单（PlayFiles 说不可写就是不可写）", () => {
    const [index] = memorySections([file("memory/index/ok.md"), file("memory/index/locked.md", false)]);
    expect(index.readOnly).toBe(false);
    expect(index.files.map((f) => f.writable)).toEqual([true, false]);
  });

  it("没有的组不占位：新建剧目只有 premise.md，就只出一组", () => {
    const groups = memorySections([file("memory/always/premise.md")]);
    expect(groups.map((g) => g.id)).toEqual(["always"]);
  });

  it("组内保持服务端给的顺序（index 的目录层次是这个顺序的一部分）", () => {
    const [index] = memorySections([
      file("memory/index/locations/school.md"),
      file("memory/index/locations/station.md"),
      file("memory/index/a.md"),
    ]);
    expect(index.files.map((f) => f.path)).toEqual([
      "memory/index/locations/school.md",
      "memory/index/locations/station.md",
      "memory/index/a.md",
    ]);
  });
});
