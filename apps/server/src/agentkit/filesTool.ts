import { readFile as readFileBytes } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { parsePlayConfig } from "@stage-ai/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { WorkshopKitDeps } from "./deps.js";
import { applyEditsToNormalizedContent, detectLineEnding, normalizeToLF, restoreLineEndings, stripBom, type TextEdit } from "./editText.js";
import { reason, textResult } from "./result.js";
import { renderReadiness } from "./readiness.js";

/**
 * 剧目文件工具组（仅工坊）：list_files / read_file / write_file / edit_file / delete_file / get_readiness / inspect_asset。
 *
 * 白名单是 PlayFiles 给的（play.json、memory/**、assets/**），agent 拿不到会话日志、谱系与 TTS 缓存。
 * 写盘（write_file 与 edit_file）对 play.json 走 parsePlayConfig 校验——模型手写 JSON 出错时不落盘、把错误回给模型重试。
 */

const emptyParams = Type.Object({}, { additionalProperties: false });
const readFileParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });
const writeFileParams = Type.Object(
  { path: Type.String({ maxLength: 300 }), content: Type.String({ maxLength: 200_000 }) },
  { additionalProperties: false },
);
const inspectAssetParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });

const replaceEditParams = Type.Object(
  {
    oldText: Type.String({
      description: "要被替换掉的原文片段。必须在文件里逐字一致地出现且**只出现一次**；同一次调用里的多段 oldText 不能互相重叠。",
    }),
    newText: Type.String({ description: "替换成的新文本。" }),
  },
  { additionalProperties: false },
);
const editFileParams = Type.Object(
  {
    path: Type.String({ maxLength: 300, description: "要编辑的文件路径（相对剧目目录），如 memory/always/craft.md。" }),
    edits: Type.Array(replaceEditParams, {
      minItems: 1,
      description:
        "一处或多处定点替换，每段都对**同一次调用开始前的原文**匹配（不是在前一段改完的结果上继续找）。" +
        "改动相邻或重叠时并成一段；不要为了连接两处远隔的改动而把中间大段没改的原文也抄进来。",
    }),
  },
  { additionalProperties: false },
);

/**
 * 兼容模型常见的写法（与 pi 的 edit 工具同一套）：
 * edits 被写成 JSON 字符串、只给一个 `{oldText,newText}` 对象、或把 oldText/newText 摆在顶层。
 */
function prepareEditArguments(input: unknown): Static<typeof editFileParams> {
  if (!input || typeof input !== "object") return input as Static<typeof editFileParams>;
  const args = input as Record<string, unknown>;
  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed;
      else if (isSingleEdit(parsed)) args.edits = [parsed];
    } catch {
      // 解析不了就原样交给 schema 校验，让模型看到校验错误
    }
  } else if (isSingleEdit(args.edits)) {
    args.edits = [args.edits];
  }
  if (typeof args.oldText !== "string" || typeof args.newText !== "string") return args as Static<typeof editFileParams>;
  const edits = Array.isArray(args.edits) ? [...args.edits] : [];
  edits.push({ oldText: args.oldText, newText: args.newText });
  const { oldText: _oldText, newText: _newText, ...rest } = args;
  return { ...rest, edits } as Static<typeof editFileParams>;
}

function isSingleEdit(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const edit = value as Record<string, unknown>;
  return typeof edit.oldText === "string" && typeof edit.newText === "string";
}

/** play.json 的结构校验：不过就抛错，调用方负责把错误原样回给模型。 */
function assertPlayConfig(content: string): void {
  try {
    parsePlayConfig(JSON.parse(content));
  } catch (error) {
    throw new Error(`play.json 校验失败，未写入：${reason(error)}`);
  }
}

/**
 * 同一文件的写操作串行（pi 的 file-mutation-queue 的最小版）。
 *
 * 一个回合里模型对同一个文件发两次 edit_file 是常见写法，并行执行会读到同一份原文、
 * 后落盘的把先落盘的整个冲掉。锁按绝对路径分，跨剧目/跨会话互不影响。
 */
const fileLocks = new Map<string, Promise<unknown>>();

function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  fileLocks.set(key, tail);
  void tail.then(() => {
    if (fileLocks.get(key) === tail) fileLocks.delete(key);
  });
  return run;
}

export function createFilesTools(
  deps: Pick<WorkshopKitDeps, "files" | "store" | "onWrite">,
): AgentTool<any>[] {
  const listFiles: AgentTool<typeof emptyParams> = {
    name: "list_files",
    label: "列出剧目文件",
    description: "列出剧目里可编辑与可查看的文件（play.json、memory/**、assets/**）。",
    parameters: emptyParams,
    execute: async () => {
      const files = await deps.files.list();
      return textResult(
        files.map((f) => `${f.writable ? "可写" : "只读"} ${f.path}（${f.size}B）`).join("\n") || "（无文件）",
      );
    },
  };

  const readFile: AgentTool<typeof readFileParams> = {
    name: "read_file",
    label: "读剧目文件",
    description: "读取剧目文件全文（限 play.json、memory/**、assets/**）。",
    parameters: readFileParams,
    execute: async (_id, params: Static<typeof readFileParams>) => {
      try {
        return textResult(await deps.files.read(params.path));
      } catch (error) {
        return textResult(`读取失败：${reason(error)}`);
      }
    },
  };

  const writeFile: AgentTool<typeof writeFileParams> = {
    name: "write_file",
    label: "写剧目文件",
    description:
      "整篇覆盖写入剧目文件（可写范围：play.json、theme.css、memory/** 的 .md/.json/.txt、assets/manifest.json）。" +
      "只想改文件里的一小段时用 edit_file——整篇覆盖一处笔误就会把全文写缩水。play.json 结构校验不过则不落盘。",
    parameters: writeFileParams,
    execute: async (_id, params: Static<typeof writeFileParams>) => {
      const { path, content } = params;
      if (path === "play.json") {
        try {
          assertPlayConfig(content);
        } catch (error) {
          return textResult(reason(error));
        }
      }
      try {
        return await withFileLock(deps.files.pathOf(path, "write"), async () => {
          let before: string | null = null;
          try {
            before = await deps.files.read(path);
          } catch {
            before = null;
          }
          const written = await deps.files.write(path, content);
          deps.onWrite({ path: written, before, after: content });
          return textResult(`已写入 ${written}（${content.length} 字）`);
        });
      } catch (error) {
        return textResult(`写入失败：${reason(error)}`);
      }
    },
  };

  /**
   * 定点编辑（仿 pi 原生 edit 工具：同一套 schema、同一套匹配语义，差别只在路径范围）。
   *
   * 与 write_file 的分工：改一两段用 edit_file，模型不必把整篇原文抄一遍，
   * 也就不会在抄写时把没打算动的部分漏掉几行。
   */
  const editFile: AgentTool<typeof editFileParams> = {
    name: "edit_file",
    label: "编辑剧目文件",
    description:
      "对剧目文件做定点替换（可写范围同 write_file）。每段 oldText 必须逐字匹配原文且在文件里唯一；" +
      "找不到完全一致的原文时会再做一次模糊匹配（行尾空白、中英文引号、连字符、全角空格），命中后只重写被改到的行，其余行原样保留。",
    parameters: editFileParams,
    prepareArguments: prepareEditArguments,
    execute: async (_id, params: Static<typeof editFileParams>) => {
      const { path, edits } = params;
      try {
        return await withFileLock(deps.files.pathOf(path, "write"), async () => {
          const before = await deps.files.read(path);
          const { bom, text } = stripBom(before);
          const ending = detectLineEnding(text);
          const { newContent } = applyEditsToNormalizedContent(normalizeToLF(text), edits as TextEdit[], path);
          const after = bom + restoreLineEndings(newContent, ending);
          if (path === "play.json") assertPlayConfig(after);
          const written = await deps.files.write(path, after);
          deps.onWrite({ path: written, before, after });
          return textResult(`已替换 ${edits.length} 处：${written}（${before.length} → ${after.length} 字）`);
        });
      } catch (error) {
        return textResult(`编辑失败：${reason(error)}`);
      }
    },
  };

  const deleteFile: AgentTool<typeof readFileParams> = {
    name: "delete_file",
    label: "删除剧目文件",
    description: "删除可写范围内的文件（memory/** 的文本、theme.css、assets/manifest.json；play.json 不可删除）。",
    parameters: readFileParams,
    execute: async (_id, params: Static<typeof readFileParams>) => {
      let before: string | null;
      try {
        before = await deps.files.read(params.path);
      } catch (error) {
        return textResult(`删除失败：${reason(error)}`);
      }
      if (params.path === "play.json") return textResult("play.json 不可删除");
      try {
        await withFileLock(deps.files.pathOf(params.path, "write"), () => deps.files.remove(params.path));
        deps.onWrite({ path: params.path, before, after: "" });
        return textResult(`已删除 ${params.path}`);
      } catch (error) {
        return textResult(`删除失败：${reason(error)}`);
      }
    },
  };

  const readiness: AgentTool<typeof emptyParams> = {
    name: "get_readiness",
    label: "检查开演条件",
    description: "检查剧目是否达到可开演条件（premise / 角色立绘映射 / 背景图）。",
    parameters: emptyParams,
    execute: async () => textResult(renderReadiness(await deps.store.readiness())),
  };

  /**
   * 看图：立绘抠底的质量只有眼睛能判。返回图片 attachment 让模型自己看，
   * 它是唯一能看到成图的 agent 侧通道——用户那边的预览是独立的。
   * 只放 assets/ 下的图像，和 read_file 同一套白名单。
   */
  const inspectAsset: AgentTool<typeof inspectAssetParams> = {
    name: "inspect_asset",
    label: "看剧目图片",
    description:
      "把 assets/ 下的一张图读进来给你自己看（真的看图，不是返回文件路径）。" +
      "立绘抠底只干净不干净、画风对不对、是不是同一个人——都靠它判断。path 用相对路径，如 assets/sprites/koharu/neutral.png。",
    parameters: inspectAssetParams,
    execute: async (_id, params: Static<typeof inspectAssetParams>) => {
      try {
        const bytes = await readFileBytes(deps.files.pathOf(params.path, "read"));
        const mimeType = sniffImageMime(bytes);
        if (!mimeType) return textResult(`${params.path} 不是可看的图片（只支持 png/jpeg/webp/gif）`);
        return {
          content: [
            { type: "text" as const, text: `${params.path}（${mimeType}，${bytes.length}B）` },
            { type: "image" as const, data: bytes.toString("base64"), mimeType },
          ],
          details: undefined,
        };
      } catch (error) {
        return textResult(`读图失败：${reason(error)}`);
      }
    },
  };

  return [listFiles, readFile, editFile, writeFile, deleteFile, readiness, inspectAsset];
}

/** 文件头嗅探（扩展名可能与实际字节不符，垫图塞错类型会被网关拒）。 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  return null;
}
