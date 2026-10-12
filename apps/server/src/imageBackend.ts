/**
 * 生图后端契约 —— 实现在 `@aivn/agent`（`media/image.ts`），两个宿主共用一份。
 *
 * 这个文件以前是那份契约的第二份拷贝（另一份在插件的 `media/image.ts`），两边靠人同步。
 * 这里只做转出，让服务端既有的一堆 `from "./imageBackend.js"` 引用点原样成立。
 */
import type { ImageBackend } from "@aivn/agent";

export {
  aspectMatches,
  extOf,
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  imageSizeText,
  parseImageSize,
  sizeOfImage,
  tierArea,
} from "@aivn/agent";
export type {
  GeneratedImage,
  ImageAspect,
  ImageBackend,
  ImageRequest,
  ImageSize,
  ImageSizeSpec,
} from "@aivn/agent";

/**
 * 生图类目：三类素材各有一份可覆盖的出图配置（`settings.json` 的 `image.kinds`）。
 *
 * 这份词表只属于服务端——类目路由是部署配置，dsh-aivn 那条线不认它，所以不进共享包。
 * 与 `@aivn/core` 的 `ASSET_KINDS`（素材资源库的六个 kind）不是一回事，别互相顶替。
 */
export const IMAGE_KINDS = ["background", "cg", "sprite"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** 生图接口格式（协议形状，不是产品名）。 */
export const IMAGE_FORMATS = ["gemini", "openai", "modelslab", "comfyui"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** 垫图策略：派生差分时要不要拿该主体的 neutral 定妆照当参考图。 */
export const IMAGE_REFERENCES = ["none", "neutral"] as const;
export type ImageReference = (typeof IMAGE_REFERENCES)[number];

/** 三类素材各自的后端实例：出图时按素材类目取（见 `PlayAssets.produce`）。 */
export type ImageBackends = Record<ImageKind, ImageBackend>;
