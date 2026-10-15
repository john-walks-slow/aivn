import { describe, expect, it } from "vitest";
import {
  AUDIO_RULES,
  castTitle,
  renderAssetSections,
  renderBareSprites,
  renderCastCard,
  renderMemoryIndex,
} from "../src/prompt/a-zone.js";

describe("renderAssetSections", () => {
  it("空类目不出现，四个类目的顺序与位置写死", () => {
    const out = renderAssetSections({ backgrounds: ["bg_a.png"], cg: ["cg_1.png"] }, () => ({}));
    expect(out).toContain("# 可用背景 bg\n\n- bg_a\n<scene> 的 bg 优先取这些 id。\n");
    expect(out).not.toContain("# 可用音乐 bgm");
    expect(out).not.toContain("# 可用音效 sfx");
    expect(out.indexOf("# 可用背景 bg")).toBeLessThan(out.indexOf("# 已有插图 cg"));
  });

  it("插图清单带用法：写 <cg id> 让那一张登场", () => {
    const out = renderAssetSections({ cg: ["cg_1.png"] }, () => ({}));
    expect(out).toContain('- cg_1\n在一幕里写 `<cg id="…"/>` 让它登场。');
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

describe("角色表", () => {
  it("标题给全 id、卡路径与「玩家扮演」——模型不该为了改卡去推路径", () => {
    expect(castTitle("mio", "澪")).toBe("澪（id: mio，卡片 characters/mio.md）");
    expect(castTitle("protagonist", "你")).toBe("你（id: protagonist，卡片 characters/protagonist.md，玩家扮演）");
    expect(castTitle("mecha")).toBe("mecha（id: mecha，卡片 characters/mecha.md）");
  });

  it("全卡：正文修边、音色与差分各占一行；差分项带说明", () => {
    const out = renderCastCard(
      {
        id: "mio",
        name: "澪",
        body: "天文社社长。\n第二行。\n",
        voice: "v_mio",
        spriteDir: "mio_alt",
        variants: ["smile", "sad"],
      },
      (id) => (id === "smile" ? { description: "微笑" } : {}),
    );
    expect(out).toBe(
      [
        "### 澪（id: mio，卡片 characters/mio.md）",
        "天文社社长。\n第二行。",
        "音色：v_mio",
        "立绘（目录 mio_alt）差分 variant：smile（微笑） | sad",
      ].join("\n"),
    );
  });

  it("没有音色与差分时不留空行；目录与卡同名时不写目录", () => {
    const out = renderCastCard({ id: "rin", body: " 老师。 ", spriteDir: "rin", variants: [] }, () => ({}));
    expect(out).toBe("### rin（id: rin，卡片 characters/rin.md）\n老师。");
  });

  it("「台上其它主体」只在真有裸立绘目录时出现，标题取自素材表", () => {
    const meta = (id: string) => (id === "mecha" ? { title: "机甲" } : id === "damaged" ? { description: "受损" } : {});
    expect(renderBareSprites([], () => [], meta)).toBe("");
    expect(renderBareSprites(["mecha"], () => ["normal", "damaged"], meta)).toBe(
      "\n\n# 台上其它主体（有立绘，没有角色卡）\n\n- mecha（机甲）：variant normal | damaged（受损）\n\n它们与角色同权：`<actor id=\"…\" variant=\"…\">` 直接上台，不用建档。",
    );
  });
});
