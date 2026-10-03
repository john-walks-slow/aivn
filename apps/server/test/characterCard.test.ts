import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlayMemory } from "../src/memory.js";
import { PlayStore } from "../src/store.js";

/**
 * 角色卡是角色配置的真相源。
 *
 * 迁移前 persona 写进 markdown、voiceId 写进 play.json，两边分家；工坊能建卡却配不上
 * 音色，因为那半边它写不进去（play.json 的单个字段没有 agent 可用的写入口）。
 * 现在 head + body 都在 markdown 里，play.json 只剩 id 清单。
 *
 * 兜底不是过渡洁癖：存量剧目（以及从资源库导入的角色）还没存过卡，
 * play.json 里那几个字段是它们唯一的配置来源，删了就丢。
 */

async function storeWith(card: string | null, play = "{}"): Promise<PlayStore> {
  const root = await mkdtemp(join(tmpdir(), "stage-card-"));
  const store = new PlayStore(root);
  if (card !== null) {
    await mkdir(store.characterDir(), { recursive: true });
    await writeFile(join(store.characterDir(), "mio.md"), card, "utf8");
  }
  await writeFile(join(root, "play.json"), play, "utf8");
  return store;
}

describe("角色卡：PlayMemory", () => {
  it("头部与正文分开读出来——voiceId 要参与合成，塞在正文里就得现场正则抠", async () => {
    const store = await storeWith("---\nname: ミオ\nvoiceId: aaa111\nvoice: 清冷少女声\n---\n# ミオ\n\n18 岁，说话简短。");
    const memory = await PlayMemory.load(store);
    const card = memory.characters.get("mio");

    expect(card.voiceId).toBe("aaa111");
    expect(card.voice).toBe("清冷少女声");
    expect(card.name).toBe("ミオ");
    expect(card.body).toContain("18 岁");
  });

  it("没有 frontmatter 的存量卡片照旧能读，正文就是全文", async () => {
    const store = await storeWith("# ミオ\n\n18 岁，说话简短。");
    const card = (await PlayMemory.load(store)).characters.get("mio");

    expect(card.body).toContain("18 岁");
    expect(card.voiceId).toBeUndefined();
  });

  it("文件名是 id 的真相：frontmatter 里写错 id 时以路径为准", async () => {
    // actor mio 引到卡上，卡却自称 yui——那这个角色的立绘和音色会串到别人身上
    const store = await storeWith("---\nid: yui\nname: ミオ\n---\n正文");
    const memory = await PlayMemory.load(store);

    expect(memory.characters.get("mio")?.name).toBe("ミオ");
    expect(memory.characters.has("yui")).toBe(false);
  });

  it("没有角色卡目录时是空表，不是抛错", async () => {
    const store = await storeWith(null);
    expect((await PlayMemory.load(store)).characters.size).toBe(0);
  });
});