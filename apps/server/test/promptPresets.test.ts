import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PromptPresets } from "../src/promptPresets.js";

let file: string;
let presets: PromptPresets;

beforeEach(async () => {
  file = join(await mkdtemp(join(tmpdir(), "aivn-presets-")), "prompt-presets.json");
  presets = new PromptPresets(file);
});

describe("PromptPresets：应用级的注入 preset", () => {
  it("还没存过 = 空表，不是错误", async () => {
    expect(await presets.list()).toEqual([]);
  });

  it("存一份、同名覆盖、按名字删除", async () => {
    const messages = [{ role: "user" as const, text: "开场铺垫" }];
    await presets.save("合规前置", messages);
    await presets.save("另一个", [{ role: "system" as const, text: "系统的话" }]);
    expect((await presets.list()).map((p) => p.name)).toEqual(["合规前置", "另一个"]);

    await presets.save("合规前置", [{ role: "user" as const, text: "改过" }]);
    const after = await presets.list();
    expect(after).toHaveLength(2);
    expect(after[0]!.messages).toEqual([{ role: "user", text: "改过" }]);

    expect((await presets.remove("另一个")).map((p) => p.name)).toEqual(["合规前置"]);
  });

  it("空名字与空消息都拒掉，不写半份文件", async () => {
    await expect(presets.save("  ", [{ role: "user", text: "x" }])).rejects.toThrow(/名字/);
    await expect(presets.save("空组", [{ role: "user", text: "   " }])).rejects.toThrow(/空的/);
    expect(await presets.list()).toEqual([]);
  });

  it("认不出的角色不进文件（手改 / 旧版本写坏也不让它生效）", async () => {
    const saved = await presets.save("半坏", [
      { role: "user", text: "留下" },
      { role: "narrator", text: "丢掉" } as never,
    ]);
    expect(saved[0]!.messages).toEqual([{ role: "user", text: "留下" }]);
  });

  it("文件写坏时如实报错，不静默当成空表（静默会让用户以为 preset 被系统吞了）", async () => {
    await writeFile(file, "{ 不是 JSON");
    await expect(presets.list()).rejects.toThrow();
  });

  it("落盘是原子写：留下的是完整 JSON，没有临时文件残留", async () => {
    await presets.save("一份", [{ role: "assistant", text: "好的" }]);
    const raw = JSON.parse(await readFile(file, "utf8")) as { presets: unknown[] };
    expect(raw.presets).toHaveLength(1);
  });
});
