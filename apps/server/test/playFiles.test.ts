import { describe, expect, it } from "vitest";
import { inWriteScopes, PlayFiles, writeScopeOf, type WriteScope } from "../src/playFiles.js";

/**
 * 能力给的是**写面**，路径知识留在这一层：`WriteScope` 必须穷尽 `PlayFiles` 的可写面。
 *
 * 这条不变量值得钉：新增一类可写文件而忘了挂 scope，用户看到的是「这个开关开着却写不进去」
 * ——模型拿着 write 工具，路径却被能力层拒了，两头都「正确」。
 */

const files = new PlayFiles({ dir: "/tmp/stage-playfiles-test" } as never);

/** 可写面：每个路径都得恰好落在一个 scope 里，且与前缀表逐条对上。 */
const WRITABLE: [string, WriteScope][] = [
  ["play.json", "config"],
  ["theme.css", "config"],
  ["assets/manifest.json", "config"],
  ["memory/always/craft.md", "memory"],
  ["memory/index/lore/旧校舍.md", "memory"],
  ["characters/mio.md", "characters"],
];

/** 不可写面：没有 scope，`PlayFiles` 也拒。 */
const NOT_WRITABLE = [
  // 引擎产物：看得见、改不动
  "memory/arcs/epoch-a-1.md",
  "memory/archive/turn-1.md",
  "memory/ARCS/epoch-a-1.md",
  // 只读素材面
  "assets/backgrounds/a.png",
  "assets/foo.json",
  // 会话与缓存
  "session.json",
  "lineage.jsonl",
  "characters/mio.png",
  "memory/index/lore/x.yaml",
];

describe("playFiles：可写面的 scope 穷尽", () => {
  it("PlayFiles 放行的每一个路径都恰好落在一个 scope 里", () => {
    for (const [rel, scope] of WRITABLE) {
      expect(() => files.pathOf(rel, "write"), rel).not.toThrow();
      expect(writeScopeOf(rel), rel).toBe(scope);
      expect(inWriteScopes(rel, [scope])).toBe(true);
      expect(inWriteScopes(rel, [])).toBe(false);
    }
  });

  it("不可写的路径没有 scope（也就永远过不了能力那一道）", () => {
    for (const rel of NOT_WRITABLE) {
      expect(() => files.pathOf(rel, "write"), rel).toThrow();
      expect(writeScopeOf(rel), rel).toBeNull();
      expect(inWriteScopes(rel, ["characters", "memory", "config"]), rel).toBe(false);
    }
  });

  it("读面不受 scope 影响：写了 scope 判定不改 PlayFiles 自己的分权", () => {
    // assets/ 与引擎产物都是「读得到、写不了」——能力层收的是写面，不是可见面
    for (const rel of ["assets/backgrounds/a.png", "memory/arcs/epoch-a-1.md"]) {
      expect(() => files.pathOf(rel, "read"), rel).not.toThrow();
    }
  });
});
