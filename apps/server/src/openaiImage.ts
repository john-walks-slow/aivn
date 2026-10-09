/**
 * OpenAI 格式生图 —— 实现在 `@aivn/agent`（`media/openai.ts`），两个宿主共用一份。
 *
 * 这个文件以前是那份协议的第二份拷贝（另一份在插件的 `media/openai-image.ts`）。这里只做转出，
 * 让服务端既有的 `from "./openaiImage.js"` 引用点原样成立。
 */
export { OpenAiImageGen, openAiCanvasFor as canvasFor } from "@aivn/agent";
export type { OpenAiImageOptions } from "@aivn/agent";
