import { describe, expect, it } from "vitest";
import { AUDIO_RULES, renderAssetSections, renderMemoryIndex } from "../src/prompt/a-zone.js";

describe("renderAssetSections", () => {
  it("空类目不出现，四个类目的顺序与位置写死", () => {
    const out = renderAssetSections({ backgrounds: ["bg_a.png"], cg: ["cg_1.png"] }, () => ({}));
    expect(out).toContain("# 可用背景 bg\n\n- bg_a\n<scene> 的 bg 优先取这些 id。\n");
    expect(out).not.toContain("# 可用音乐 bgm");
    expect(out).not.toContain("# 可用音效 sfx");
    expect(out.indexOf("# 可用背景 bg")).toBeLessThan(out.indexOf("# 已有插图 cg"));
  });

  it("清单项带素材表里的说明（描述｜标签｜情绪｜时长）", () => {
    const out = renderAssetSections({ sfx: ["se_door.ogg"] }, (id) => ({
      description: id === "se_door" ? "木门推开" : "",
      mood: ["日常"],
      durationSec: 2,
    }));
    expect(out).toContain("- se_door（木门推开｜情绪：日常｜约 2 秒）");
  });

  it("配乐规则只在真有 bgm/sfx 时插在 sfx 与 cg 之间", () => {
    const quiet = renderAssetSections({ cg: ["cg_1.png"] }, () => ({}), { audioRules: AUDIO_RULES });
    expect(quiet).not.toContain("# 配乐与音效");

    const loud = renderAssetSections({ bgm: ["bgm_a.mp3"], cg: ["cg_1.png"] }, () => ({}), { audioRules: AUDIO_RULES });
    expect(loud).toContain(`\n${AUDIO_RULES}`);
    expect(loud.indexOf("# 配乐与音效")).toBeLessThan(loud.indexOf("# 已有插图 cg"));
    // 块与块之间正好一行空行（多一个少一个都会让 markdown 结构变味）
    expect(loud).toContain("- bgm_a\n\n# 配乐与音效");
  });
});

describe("renderMemoryIndex", () => {
  it("每行带 [分类] 前缀与卡自己的路径；顶层卡不打空括号", () => {
    const out = renderMemoryIndex(
      [
        { layer: "lore", name: "旧校舍", summary: "三年前封了。", path: "memory/index/lore/旧校舍.md" },
        { layer: "", name: "散记", summary: "顶层卡。", path: "memory/index/散记.md" },
      ],
      "要某条的完整内容就 read 它的路径。",
    );
    expect(out).toBe(
      [
        "# 记忆索引（按需查详情）",
        "",
        "- [lore] 旧校舍（memory/index/lore/旧校舍.md）：三年前封了。",
        "- 散记（memory/index/散记.md）：顶层卡。",
        "",
        "要某条的完整内容就 read 它的路径。",
      ].join("\n"),
    );
  });

  it("没有卡就整段不出现（不是留个空标题）", () => {
    expect(renderMemoryIndex([], "任意")).toBe("");
  });
});
