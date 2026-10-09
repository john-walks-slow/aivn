import { describe, expect, it } from "vitest";
import { assetGenerate, assetGenerateFields } from "../src/capabilities/asset/generate.js";
import type { AssetRegisterDeps } from "../src/capabilities/asset/register.js";
import { assertCommonSubset } from "../src/schema/ir.js";
import type { ImageGenerateRequest } from "../src/capabilities/image/generate.js";

/** 假宿主：出图给一张候选、抠底给一个透明 PNG、登记给回执；三条都被记下来。 */
function host(over: { exists?: boolean; withCut?: boolean } = {}) {
  const steps: string[] = [];
  const produced: ImageGenerateRequest[] = [];
  const registered: Array<{ source: string; location: unknown; extra: unknown }> = [];
  const deps = {
    exists: async () => {
      steps.push("exists");
      return over.exists ?? false;
    },
    produce: {
      run: async (request: ImageGenerateRequest) => {
        steps.push("produce");
        produced.push(request);
        return { path: "media-cache/drafts/d1/image.png", adopted: false };
      },
    },
    ...(over.withCut === false
      ? {}
      : {
          cut: async ({ source }: { source: string }) => {
            steps.push("cut");
            return { path: `media-cache/drafts/d1/cut-${source.split("/").pop()}` };
          },
        }),
    register: async (source: string, location: unknown, extra: unknown) => {
      steps.push("register");
      registered.push({ source, location, extra });
      return { kind: "sprite" as const, path: "assets/sprites/mio/neutral.png", replaced: false };
    },
  } satisfies AssetRegisterDeps & Record<string, unknown>;
  return { steps, produced, registered, deps };
}

describe("asset.generate（显式宏）", () => {
  it("字段 = 出图那一份 + 一句画面描述；kind 在宏里是必填", () => {
    expect(() => assertCommonSubset(assetGenerateFields, "asset.generate")).not.toThrow();
    expect(assetGenerate.fields.kind.required).toBe(true);
    expect(assetGenerate.fields.description.type).toBe("string");
  });

  it("文档第一句就说清它是哪三件事的组合，并把「同名跳过」明写出来", () => {
    expect(assetGenerate.doc).toContain("`generate_image` +（立绘）`cut` + `import_asset` 的组合");
    expect(assetGenerate.doc).toContain("同名素材已经有了就直接返回");
  });

  it("立绘：出候选 → 抠底 → 登记透明 PNG，原片作为留底一起交出去", async () => {
    const { steps, registered, deps } = host();
    const out = await assetGenerate.execute(
      { kind: "sprite", spriteId: "mio", prompt: "a girl", description: "笑着的澪" },
      deps,
    );
    expect(steps).toEqual(["exists", "produce", "cut", "register"]);
    expect(out.skipped).toBe(false);
    expect(registered).toEqual([
      {
        source: "media-cache/drafts/d1/cut-image.png",
        location: { kind: "sprite", spriteId: "mio", variant: "neutral" },
        extra: { description: "笑着的澪", prompt: "a girl", original: "media-cache/drafts/d1/image.png" },
      },
    ]);
  });

  it("背景：不抠底，候选直接登记", async () => {
    const { steps, registered, deps } = host();
    await assetGenerate.execute({ kind: "background", name: "rooftop", prompt: "rooftop" }, deps);
    expect(steps).toEqual(["exists", "produce", "register"]);
    expect(registered[0]!.source).toBe("media-cache/drafts/d1/image.png");
    expect(registered[0]!.extra).toEqual({ prompt: "rooftop" });
  });

  it("同名素材已经有了：一步都不做（不烧配额），回执由宿主按 skipped 出", async () => {
    const { steps, deps } = host({ exists: true });
    const out = await assetGenerate.execute({ kind: "cg", name: "cg_01", prompt: "x" }, deps);
    expect(steps).toEqual(["exists"]);
    expect(out).toEqual({ target: { kind: "cg", name: "cg_01" }, skipped: true });
  });

  it("宿主没有抠底能力时不硬造兜底：立绘登记的就是候选那张", async () => {
    const { steps, registered, deps } = host({ withCut: false });
    await assetGenerate.execute({ kind: "sprite", spriteId: "mio", prompt: "a girl" }, deps);
    expect(steps).toEqual(["exists", "produce", "register"]);
    expect(registered[0]!.source).toBe("media-cache/drafts/d1/image.png");
    expect(registered[0]!.extra).toEqual({ prompt: "a girl" });
  });
});
