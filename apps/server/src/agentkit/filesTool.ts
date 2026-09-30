import { readFile as readFileBytes } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { parsePlayConfig } from "@stage-ai/core";
import { type Static, Type } from "@earendil-works/pi-ai";
import type { WorkshopKitDeps } from "./deps.js";
import { reason, textResult } from "./result.js";
import { renderReadiness } from "./readiness.js";

/**
 * 剧目文件工具组（仅工坊）：list_files / read_file / write_file / delete_file / get_readiness / inspect_asset。
 *
 * 白名单是 PlayFiles 给的（play.json、memory/**、assets/**），agent 拿不到会话日志、谱系与 TTS 缓存。
 * write_file 对 play.json 走 parsePlayConfig 校验——模型手写 JSON 出错时不落盘、把错误回给模型重试。
 */

const emptyParams = Type.Object({}, { additionalProperties: false });
const readFileParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });
const writeFileParams = Type.Object(
  { path: Type.String({ maxLength: 300 }), content: Type.String({ maxLength: 200_000 }) },
  { additionalProperties: false },
);
const inspectAssetParams = Type.Object({ path: Type.String({ maxLength: 300 }) }, { additionalProperties: false });

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
      "写入剧目文件（可写范围：play.json、memory/** 的 .md/.json/.txt、assets/manifest.json）。play.json 结构校验不过则不落盘。",
    parameters: writeFileParams,
    execute: async (_id, params: Static<typeof writeFileParams>) => {
      const { path, content } = params;
      if (path === "play.json") {
        try {
          parsePlayConfig(JSON.parse(content));
        } catch (error) {
          return textResult(`play.json 校验失败，未写入：${reason(error)}`);
        }
      }
      let before: string | null = null;
      try {
        before = await deps.files.read(path);
      } catch {
        before = null;
      }
      try {
        const written = await deps.files.write(path, content);
        deps.onWrite({ path: written, before, after: content });
        return textResult(`已写入 ${written}（${content.length} 字）`);
      } catch (error) {
        return textResult(`写入失败：${reason(error)}`);
      }
    },
  };

  const deleteFile: AgentTool<typeof readFileParams> = {
    name: "delete_file",
    label: "删除剧目文件",
    description: "删除 memory/ 下的文件（play.json 不可删除）。",
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
        await deps.files.remove(params.path);
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
        const bytes = await readFileBytes(deps.files.absoluteOf(params.path));
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

  return [listFiles, readFile, writeFile, deleteFile, readiness, inspectAsset];
}

/** 文件头嗅探（扩展名可能与实际字节不符，垫图塞错类型会被网关拒）。 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 12 && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  return null;
}
