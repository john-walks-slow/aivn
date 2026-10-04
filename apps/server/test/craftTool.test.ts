import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlayConfig, type CraftParams } from "@aivn/core";
import { createSetCraftTool } from "../src/agentkit/craftTool.js";
import { PlayFiles } from "../src/playFiles.js";
import { PlayStore } from "../src/store.js";
import type { WorkshopWrite } from "../src/agentkit/deps.js";

/** 造一份最小剧目：`extra` 用来摆 craft 或引擎不认识的手写字段。 */
async function setup(extra: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "stage-craft-"));
  await writeFile(
    join(dir, "play.json"),
    JSON.stringify(
      {
        id: "t",
        title: "测试剧目",
        opening: "（开始）",
        initialState: { turn: 0, affinity: {}, flags: {} },
        initialScene: "走廊",
        ...extra,
      },
      null,
      2,
    ),
  );
  const store = new PlayStore(dir);
  const files = new PlayFiles(store);
  const writes: WorkshopWrite[] = [];
  const tool = createSetCraftTool({
    files,
    store,
    onWrite: (write) => writes.push(write),
  });
  const call = async (params: Record<string, unknown>): Promise<string> => {
    const result = await tool.execute("call_1", params as never);
    return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  };
  const craftOf = async (): Promise<CraftParams | undefined> => {
    const play = parsePlayConfig(JSON.parse(await readFile(join(dir, "play.json"), "utf8")));
    return play.craft;
  };
  return { dir, writes, call, craftOf };
}

describe("set_craft：只改 craft 这一段", () => {
  it("给一个字段就写一个，回执里带新的生效值", async () => {
    const { writes, call, craftOf } = await setup();
    const text = await call({ beatLength: "long" });
    expect(await craftOf()).toEqual({ beatLength: "long" });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe("play.json");
    expect(writes[0]!.before).toContain('"title": "测试剧目"');
    expect(text).toContain("每轮篇幅：长");
  });

  it("省略的字段保持现状，不是回默认", async () => {
    const { call, craftOf } = await setup({ craft: { beatLength: "long" } });
    await call({ stopOptions: "two" });
    expect(await craftOf()).toEqual({ beatLength: "long", stopOptions: "two" });
  });

  it("给 null = 恢复默认：那一行从 play.json 里消失", async () => {
    const { call, craftOf } = await setup({ craft: { beatLength: "long", stopOptions: "two" } });
    await call({ beatLength: null });
    expect(await craftOf()).toEqual({ stopOptions: "two" });
  });

  it("写成默认值等于没写：craft 段整段消失，也不留空壳", async () => {
    const { writes, call, craftOf } = await setup({ craft: { beatLength: "long" } });
    await call({ beatLength: "medium" });
    expect(await craftOf()).toBeUndefined();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.after).not.toContain('"craft"');
  });

  it("素材来源逐类改，不牵连同表其它项", async () => {
    const { call, craftOf } = await setup({ craft: { assets: { background: "generate" } } });
    await call({ assets: { cg: "off" } });
    expect(await craftOf()).toEqual({ assets: { background: "generate", cg: "off" } });
  });

  it("一个字段都不给：回执里报现状，但一个字节都不写", async () => {
    const { writes, call } = await setup({ craft: { beatLength: "long" } });
    const text = await call({});
    expect(text).toContain("每轮篇幅：长");
    expect(writes).toHaveLength(0);
  });

  it("只换 craft 一个键：引擎不认识的手写字段照旧躺在文件里", async () => {
    const { dir, call } = await setup({ customNote: "手写的备注", craft: { beatLength: "long" } });
    await call({ stopOptions: "four" });
    const raw = JSON.parse(await readFile(join(dir, "play.json"), "utf8")) as Record<string, unknown>;
    expect(raw.customNote).toBe("手写的备注");
    expect(raw.craft).toEqual({ beatLength: "long", stopOptions: "four" });
  });
});
