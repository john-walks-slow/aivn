import { describe, expect, it } from "vitest";
import {
  composeImagePrompt,
  CG_PROMPT_SYSTEM,
  BG_PROMPT_SYSTEM,
  SPRITE_PROMPT_SYSTEM,
} from "../src/imagePrompt.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

function makeMockDeps(response: string) {
  let capturedSystem = "";
  let capturedUser = "";
  const streamFn: StreamFn = async (_model, ctx) => {
    // 检查 ctx 的结构
    const c = ctx as any;
    capturedSystem = c.systemPrompt ?? "";
    const msgs = c.messages ?? [];
    for (const m of msgs) {
      const text =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((b: any) => b.text ?? "").join("")
            : "";
      if (m.role === "system") {
        capturedSystem = text;
      } else if (m.role === "user") {
        capturedUser = text;
      }
    }
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", delta: response };
        yield { type: "done", reason: "stop" };
      },
    } as any;
  };
  const model = { id: "test-model", provider: "test" } as Model<any>;
  return {
    deps: { streamFn, model, getApiKey: () => "test-key" },
    getCaptured: () => ({ system: capturedSystem, user: capturedUser }),
  };
}

describe("imagePrompt", () => {
  it("cg 模式：包含系统提示词、剧情、场景与玩家指令", async () => {
    const validPrompt =
      "A dramatic wide angle anime illustration of Koharu standing under the rain with an umbrella, soft lighting, detailed background";
    const { deps, getCaptured } = makeMockDeps(validPrompt);

    const result = await composeImagePrompt(deps, "cg", {
      lines: ["小春：雨下得好大啊。", "男主：快到伞底下来。"],
      scene: "雨中的车站站台",
      instruction: "画一个两人在伞下相视而笑的特写",
      craft: "日系轻小说赛璐珞画风",
      useHistory: true,
      referenceCharacters: [
        { id: "koharu", name: "小春", body: "粉色双马尾高中生" },
        { id: "hero", name: "男主", body: "黑色短发高中生" },
      ],
    });

    expect(result).toBe(validPrompt);
    const { system, user } = getCaptured();
    expect(system).toBe(CG_PROMPT_SYSTEM);
    expect(user).toContain("【当前场景】雨中的车站站台");
    expect(user).toContain("【刚才演到的（最新在最后）】");
    expect(user).toContain("小春：雨下得好大啊。");
    expect(user).toContain("【参考角色（编号即垫图顺序）】");
    expect(user).toContain("[参考图 1] 小春");
    expect(user).toContain("[参考图 2] 男主");
    expect(user).toContain("【要求/指令】画一个两人在伞下相视而笑的特写");
  });

  it("cg 模式：useHistory=false 时丢弃台词与场景", async () => {
    const validPrompt =
      "A cinematic anime illustration of Koharu smiling gently under a starry night sky, cel shaded, highly detailed";
    const { deps, getCaptured } = makeMockDeps(validPrompt);

    await composeImagePrompt(deps, "cg", {
      lines: ["台词一", "台词二"],
      scene: "原场景",
      useHistory: false,
      instruction: "星空下的唯美单人插图",
      referenceCharacters: [{ id: "koharu", name: "小春", body: "粉色双马尾" }],
    });

    const { user } = getCaptured();
    expect(user).not.toContain("【当前场景】");
    expect(user).not.toContain("【刚才演到的");
    expect(user).toContain("[参考图 1] 小春");
    expect(user).toContain("【要求/指令】星空下的唯美单人插图");
  });

  it("sprite 模式：使用立绘系统提示词并聚焦目标角色卡与表情", async () => {
    const validPrompt =
      "Koharu with a shy blushing expression, pink twin tails, school uniform, detailed cute face";
    const { deps, getCaptured } = makeMockDeps(validPrompt);

    const result = await composeImagePrompt(deps, "sprite", {
      targetCharacter: {
        id: "koharu",
        name: "小春",
        body: "高二女生，粉发双马尾，性格害羞内向，喜欢看书",
      },
      expression: "shy",
      instruction: "脸颊泛红，眼神有些移开",
      craft: "干净的赛璐珞平涂线条",
    });

    expect(result).toBe(validPrompt);
    const { system, user } = getCaptured();
    expect(system).toBe(SPRITE_PROMPT_SYSTEM);
    expect(user).toContain("【目标角色】\n- 小春（id: koharu）：\n高二女生，粉发双马尾");
    expect(user).toContain("【目标表情/状态】shy");
    expect(user).toContain("【要求/指令】脸颊泛红，眼神有些移开");
    expect(user).not.toContain("【当前场景】");
  });

  it("background 模式：使用背景系统提示词", async () => {
    const validPrompt =
      "A sunlit classroom during golden hour sunset, empty desks, orange light filtering through curtains, anime background art";
    const { deps, getCaptured } = makeMockDeps(validPrompt);

    const result = await composeImagePrompt(deps, "background", {
      instruction: "放学后的空教室，夕阳斜照",
      craft: "新海诚风光影",
    });

    expect(result).toBe(validPrompt);
    const { system, user } = getCaptured();
    expect(system).toBe(BG_PROMPT_SYSTEM);
    expect(user).toContain("【要求/指令】放学后的空教室，夕阳斜照");
    expect(user).toContain("【创作口径/画风设定】");
  });

  it("空响应抛错", async () => {
    const { deps } = makeMockDeps("   ");
    await expect(
      composeImagePrompt(deps, "cg", { instruction: "test" }),
    ).rejects.toThrow("模型返回空文本");
  });
});
