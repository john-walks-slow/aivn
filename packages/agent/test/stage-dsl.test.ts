import { describe, expect, it } from "vitest";
import { ACTOR_RULES, CG_RULES, COMMENT_HEAD, CONTRACT_INTRO, DIALOGUE_TAGS } from "../src/index.js";

/**
 * Stage DSL 共用正文：两个宿主逐字相同的那几块。
 *
 * 这些断言是**防手滑**的：句子被改写一个字，两个宿主演出来的就是两种戏。
 * 内容本身没什么可测的，测的是「该在的要素都还在」。
 */

describe("立绘与行为词那块", () => {
  it("四个可选属性、台上同权、取景体量、行为词表都在", () => {
    for (const word of ["variant", "shot", "action", "leave"]) {
      expect(ACTOR_RULES).toContain(`| ${word} |`);
    }
    expect(ACTOR_RULES).toContain("台上的一切同权");
    expect(ACTOR_RULES).toContain("素材自己的声明");
    expect(ACTOR_RULES).toContain("nudge");
    expect(ACTOR_RULES).toContain("| 词 | 效果 | 什么场合 |");
    expect(ACTOR_RULES).toContain("使用频率约 1/10，即十句台词或十次动作里最多出现一两次");
    expect(ACTOR_RULES).toContain("绝大多数 `<actor>` 只切 `variant`、不带 `action`");
    expect(ACTOR_RULES).toContain("没有明确的动作或反应门槛");
    expect(ACTOR_RULES).toContain("nudge | 极轻地左右晃一下 | 动摇、犹豫");
    expect(ACTOR_RULES).toContain("同一时刻只给一个人一个行为词。");
    // 位置由引擎分配，剧本不写
    expect(ACTOR_RULES).toContain("**位置不用你写。**");
  });

  it("不许出现宿主专有语汇（fx / 标题卡 / 停止点载体）", () => {
    expect(ACTOR_RULES).not.toContain("<fx");
    expect(ACTOR_RULES).not.toContain("title");
    expect(ACTOR_RULES).not.toContain("beat_done");
  });
});

describe("另三块", () => {
  it("台词三类与注释章首", () => {
    expect(DIALOGUE_TAGS.split("\n")).toHaveLength(3);
    expect(DIALOGUE_TAGS).toContain('<say id="角色id"');
    expect(COMMENT_HEAD).toContain("## 注释（不产生活动内容）");
    expect(COMMENT_HEAD).toContain("<comment>正文</comment>");
    // 尾句各宿主不同（服务端还提「不进谱系」），不在这块里
    expect(COMMENT_HEAD).not.toContain("谱系");
  });

  it("演出契约只到第 2 条——第 3 条起讲各宿主自己的状态面", () => {
    expect(CONTRACT_INTRO).toContain("你是剧本引擎，不是助手");
    expect(CONTRACT_INTRO).toContain("1. 指令先于台词");
    expect(CONTRACT_INTRO).toContain("2. 角色情绪/表情变化时");
    expect(CONTRACT_INTRO).not.toContain("3. ");
  });
});

describe("插图那块", () => {
  it("四条机制都在：引用不是生成、caption、铺满整屏、下一次 actor / 换底才撤", () => {
    expect(CG_RULES).toContain("## 插图（cg）");
    expect(CG_RULES).toContain('<cg id="cg_confession" caption="天台上的告白"/>');
    expect(CG_RULES).toContain("这一行是**引用**那张画");
    expect(CG_RULES).toContain("盖住背景与立绘");
    expect(CG_RULES).toContain("直到下一次 `<actor>` 或换底 `<scene bg>` 把它撤掉");
  });

  it("不点名生图工具——两个宿主的工具面不同名，点名会把另一个教坏", () => {
    expect(CG_RULES).not.toContain("generate_image");
    expect(CG_RULES).not.toContain("generate_asset");
  });
});
