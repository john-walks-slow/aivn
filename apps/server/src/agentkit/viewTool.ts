import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { extOf } from "../imageBackend.js";
import { IMAGE_EXTS, mimeForExt, sniffImageMime } from "../imageMime.js";
import { MAX_WEB_IMAGE_BYTES, type WebImage, type WebImageFetcher, webImageBase } from "../webImage.js";
import { reason, textResult } from "./result.js";

/**
 * `view_image`：把一张图读进来给模型自己看（仅工坊）。
 *
 * 两种来源同一个参数：
 * - 剧目内的路径（`assets/sprites/<角色id>/neutral.png`）——用户上传的图、站内生成的图；
 * - http(s) 网址——用户丢来一个链接、或者 `web_search` 找到的图床地址。
 *
 * 通用化是因为「看图」本来就不是出图流程的一环：它是模型自己决定要不要用的一个动作，
 * 用途也不止抠底（对画风、核对角色卡、比对两个差分）。所以工具描述只说这是什么、能拿来干什么，
 * 不规定什么时候必须看——那是流程，硬写进系统提示词只会让模型每次出图都白看一遍。
 *
 * 网络分支不装配时不注册：本地素材照看不误，只是看不了网址。
 */

const viewImageParams = Type.Object(
  {
    source: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "剧目内的相对路径（如 assets/sprites/<角色id>/neutral.png），或一张图片的 http(s) 网址。" +
        "网址会下载到本机缓存再读，不进剧目。",
    }),
  },
  { additionalProperties: false },
);

const DESCRIPTION = [
  "把一张图读进来给你自己看（真的看图，不是返回文件路径）。",
  "source 可以是剧目内的相对路径（assets/ 下用户上传或站内生成的图），也可以是一张图片的网址（会下载到本机缓存）。",
  "什么时候用你自己判断：核对立绘的外貌与抠底边缘、研究用户给的参考图或链接、比对同一角色的两个差分像不像同一个人。",
  "看不出来的东西别硬编——没看过的图，不要在汇报里写成看过的。",
].join("\n");

export interface ViewImageDeps {
  /** 剧目内路径 → 绝对路径，越界的路径由它抛错（白名单是 PlayFiles 给的）。 */
  pathOf: (path: string) => string;
  /** 网络图缓存目录（media-cache/web-images，跑批产物不进 git）。 */
  cacheDir: () => string;
  /** 没配就返回 undefined：工具只认本地路径。 */
  fetchImage?: WebImageFetcher;
}

export function createViewImageTool(deps: ViewImageDeps): AgentTool<typeof viewImageParams> {
  return {
    name: "view_image",
    label: "看图",
    description: DESCRIPTION,
    parameters: viewImageParams,
    execute: async (_toolCallId, params: Static<typeof viewImageParams>) => {
      const source = params.source.trim();
      try {
        return /^https?:\/\//i.test(source) ? await viewRemote(source, deps) : await viewLocal(source, deps);
      } catch (error) {
        return textResult(`读图失败：${reason(error)}`);
      }
    },
  };
}

/** 网络图：先看缓存有没有，命中就直接读（同一张网图一轮对话里看多次只下一次）。 */
async function viewRemote(url: string, deps: ViewImageDeps): Promise<AgentToolResult> {
  if (!deps.fetchImage) return textResult("看网络图未启用（没配下载出口），只能看剧目内的图。");
  const dir = deps.cacheDir();
  const base = webImageBase(url);
  const caption = `${url}\n（缓存在 ${dir}）`;
  const cached = IMAGE_EXTS.map((ext) => join(dir, `${base}${ext}`)).find(existsSync);
  if (cached) return attach(caption, { data: await readFile(cached), mimeType: mimeForExt(extname(cached))! });
  const image = await deps.fetchImage(url);
  await mkdir(dir, { recursive: true });
  // 先写 .part 再改名：写到一半被打断只会留下一个 .part，不会让半张图冒充缓存永久命中
  const target = join(dir, `${base}${extOf(image.mimeType)}`);
  await writeFile(`${target}.part`, image.data);
  await rename(`${target}.part`, target);
  return attach(caption, image);
}

/** 剧目内：只认 PlayFiles 的白名单路径，剧目文件之外的一律读不到。 */
async function viewLocal(path: string, deps: ViewImageDeps): Promise<AgentToolResult> {
  const file = deps.pathOf(path);
  // 与网络分支同一个上限：一张 50MB 的图塞进对话就是几万 token 的沉默爆炸
  const { size } = await stat(file);
  if (size > MAX_WEB_IMAGE_BYTES) {
    return textResult(`${path} 有 ${(size / 1048576).toFixed(1)}MB，看不了（图上限 ${MAX_WEB_IMAGE_BYTES / 1048576}MB）`);
  }
  const data = await readFile(file);
  const mimeType = sniffImageMime(data);
  if (!mimeType) return textResult(`${path} 不是一张能看的图（只支持 png/jpeg/webp/gif）`);
  return attach(path, { data, mimeType });
}

function attach(caption: string, image: WebImage): AgentToolResult {
  return {
    content: [
      { type: "text" as const, text: `${caption}（${image.mimeType}，${image.data.length}B）` },
      { type: "image" as const, data: image.data.toString("base64"), mimeType: image.mimeType },
    ],
    details: undefined,
  };
}