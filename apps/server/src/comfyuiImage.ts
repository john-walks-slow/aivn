/**
 * ComfyUI 原生 API 生图 —— 实现在 `@aivn/agent`（`media/comfyui.ts`），两个宿主共用一份。
 *
 * 与 `openaiImage.ts` / `geminiImage.ts` 一样，这里只做转出，让服务端既有的一堆
 * `from "./comfyuiImage.js"` 引用点原样成立。
 */
export { ComfyUiImageGen } from "@aivn/agent";
export type { ComfyUiImageOptions } from "@aivn/agent";
