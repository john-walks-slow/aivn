import { describe, expect, it } from "vitest";
import { playReadiness, readPlayReadiness, renderReadiness } from "../src/index.js";

describe("play.readiness", () => {
  it("报告由宿主读盘、能力渲染：同一份判据与同一段文本", async () => {
    const blank = {
      play: false,
      strayCraft: ["craft.beatLength = 42（只认 short / medium / long）"],
      stateProblem: "state.json 不是合法 JSON",
      premise: false,
      characters: 0,
      sprites: false,
      background: false,
      assets: 0,
      danglingAssets: ["bg_gone"],
    };
    const text = await playReadiness.execute({}, { read: () => blank });
    expect(text).toBe(renderReadiness(blank));
    // 报告要把「读不出来的原因」「台账对不上」这类可修的东西报全（不是三行概览）
    expect(text).toContain("这还不是一座剧目");
    expect(text).toContain("craft.beatLength");
    expect(text).toContain("bg_gone");
  });

  it("缺什么都能开演：这句话必须在报告里（它不是闸门）", async () => {
    const text = await playReadiness.execute(
      {},
      {
        read: () => ({
          play: true,
          strayCraft: [],
          premise: false,
          characters: 0,
          sprites: false,
          background: false,
          assets: 0,
          danglingAssets: [],
        }),
      },
    );
    expect(text).toContain("没有硬门槛");
  });

  it("读盘判据能直接吃一座空目录（不抛）：缺 play.json 只是「还不是剧目」", () => {
    const r = readPlayReadiness("/tmp/aivn-readiness-does-not-exist");
    expect(r.play).toBe(false);
    expect(r.problem).toBeUndefined();
    expect(r.characters).toBe(0);
  });
});
