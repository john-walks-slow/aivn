import { describe, expect, it } from "vitest";
import { parseCharacterCard, serializeCharacterCard } from "../src/play/characterCard.js";

/**
 * 角色卡的 frontmatter 头。
 *
 * 手写解析而不是引 YAML：字段集固定且很小，规则必须与「模型会怎么写」对齐。
 * 这几条用例就是那份对齐清单——模型真实会犯的几种写法，都得读回来。
 */

describe("角色卡 frontmatter", () => {
  it("没有 frontmatter 的存量卡片照旧能读，正文就是全文", () => {
    const doc = parseCharacterCard("# ミオ\n\n18 岁，说话简短。\n");
    expect(doc.body).toBe("# ミオ\n\n18 岁，说话简短。");
    expect(doc.name).toBeUndefined();
  });

  it("往返：头部 + 正文原样回来", () => {
    const doc = { id: "mio", name: "ミオ", voice: "清冷少女声", voiceId: "aaa111", body: "# ミオ\n\n18 岁。" };
    const back = parseCharacterCard(serializeCharacterCard(doc));
    expect(back).toEqual(doc);
  });

  it("模型会给值加引号，两种引号都读回来", () => {
    expect(parseCharacterCard('---\nname: "ミオ"\n---\n正文').name).toBe("ミオ");
    expect(parseCharacterCard("---\nvoice: '清冷 少女'\n---\n正文").voice).toBe("清冷 少女");
    expect(parseCharacterCard('---\nvoiceId: "aaa:111"\n---\n正文').voiceId).toBe("aaa:111");
  });

  it("值里带冒号时序列化要加引号，否则读回来被截断", () => {
    const text = serializeCharacterCard({ voice: "低沉 磁性: 很", body: "正文" });
    expect(parseCharacterCard(text).voice).toBe("低沉 磁性: 很");
  });

  it("头部没字段时不留空 fence", () => {
    expect(serializeCharacterCard({ body: "# ミオ\n\n正文" })).toBe("# ミオ\n\n正文");
  });

  it("字段顺序固定，diff 才稳定", () => {
    const a = serializeCharacterCard({ id: "a", name: "甲", voiceId: "v1", body: "x" });
    const b = serializeCharacterCard({ id: "a", name: "甲", voiceId: "v1", body: "x" });
    expect(a).toBe(b);
    expect(a.indexOf("id:")).toBeLessThan(a.indexOf("name:"));
    expect(a.indexOf("name:")).toBeLessThan(a.indexOf("voiceId:"));
  });

  it("CRLF 与 BOM 都要吃得下——工坊在不同来源之间搬过卡", () => {
    expect(parseCharacterCard("---\r\nname: ミオ\r\n---\r\n正文").name).toBe("ミオ");
    expect(parseCharacterCard("﻿---\nname: ミオ\n---\n正文").name).toBe("ミオ");
  });

  it("fence 没闭合就当纯正文，不吞掉整张卡", () => {
    // 模型忘了收尾时，丢掉头部但保住人设，比整张卡读成空强
    const doc = parseCharacterCard("---\nname: ミオ\n\n# ミオ\n\n18 岁。");
    expect(doc.name).toBeUndefined();
    expect(doc.body).toContain("18 岁");
  });

  it("未知字段丢掉，不进内存", () => {
    const doc = parseCharacterCard("---\nname: ミオ\nmood: 阴郁\n---\n正文");
    expect(doc.name).toBe("ミオ");
    expect(doc).not.toHaveProperty("mood");
  });

  it("差分映射与逐差分取景是块状字段，读回来是普通 map", () => {
    const doc = parseCharacterCard(
      "---\nframing: half\nsprites:\n  smile: mio_smile.png\n  neutral: mio_neutral.png\n" +
        "spriteFraming:\n  shout: full\n---\n正文",
    );
    expect(doc.framing).toBe("half");
    expect(doc.sprites).toEqual({ neutral: "mio_neutral.png", smile: "mio_smile.png" });
    expect(doc.spriteFraming).toEqual({ shout: "full" });
  });

  it("景别取值不合法就丢掉，不静默当全身", () => {
    // 错的景别会让立绘按错的画幅摆位，比少一个字段更难查
    expect(parseCharacterCard("---\nframing: bust\n---\n正文").framing).toBeUndefined();
    expect(parseCharacterCard("---\nspriteFraming:\n  shout: 全身\n---\n正文").spriteFraming).toBeUndefined();
  });

  it("map 的键排序固定，模型重排也不产生 diff", () => {
    const a = serializeCharacterCard({ id: "m", sprites: { smile: "s.png", neutral: "n.png" }, body: "x" });
    const b = serializeCharacterCard({ id: "m", sprites: { neutral: "n.png", smile: "s.png" }, body: "x" });
    expect(a).toBe(b);
    expect(a.indexOf("neutral:")).toBeLessThan(a.indexOf("smile:"));
  });
});