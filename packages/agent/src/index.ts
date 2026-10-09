/**
 * `@aivn/agent` —— AIVN 的共享 agent 面。
 *
 * 边界（详见 `stage-ai/docs/features/261009-aivn-agent-package/`）：
 *
 * - **进这个包**：能力（参数规格 + 文档 + 副作用 + 实现）、use case、提示词与技能正文、
 *   中立 schema IR；任何**两个宿主都有第二份拷贝**的东西。
 * - **不进这个包**：工具名/角色/能力位/同步还是排产（那是宿主的 face）、会话与权限与队列、
 *   任何宿主 SDK 的类型（`ContentBlock` / TypeBox / `defineTool`）。
 */
export type { Field, FieldMap, HostField, HostFieldMap, HostTightening, InferArgs, InferValue, SchemaNode } from "./schema/ir.js";
export { assertCommonSubset, pick, tighten } from "./schema/ir.js";

export type { Capability } from "./capabilities/capability.js";
export type { CapabilityEntry } from "./capabilities/index.js";
export { CAPABILITIES } from "./capabilities/index.js";
export type {
  ImageGenerateDeps,
  ImageGenerateRequest,
  ImageTarget,
} from "./capabilities/image/generate.js";
export {
  IMAGE_GENERATE_DOC,
  IMAGE_PROMPT_RULES,
  IMAGE_REFERENCE_RULE,
  imageGenerate,
  imageGenerateFields,
  imageTargetOf,
  MAX_IMAGE_REFERENCES,
  resolveImageRefs,
} from "./capabilities/image/generate.js";
export type { CutoutRequest, ImageCutoutDeps } from "./capabilities/media/cutout.js";
export {
  CUTOUT_TUNING_GUIDE,
  cutoutTuningFields,
  IMAGE_CUTOUT_DOC,
  imageCutout,
  imageCutoutFields,
  type CutoutResult as ImageCutoutResult,
  tuningOf as cutoutTuningOf,
} from "./capabilities/media/cutout.js";
export type { MusicGenerateDeps, MusicGenerateRequest } from "./capabilities/music/generate.js";
export {
  musicGenerate,
  musicGenerateFields,
  MUSIC_GENERATE_DOC,
  requestOf as musicRequestOf,
  skipReceipt as musicSkipReceipt,
} from "./capabilities/music/generate.js";
export type { VoiceListDeps } from "./capabilities/voice/list.js";
export {
  renderVoiceRow,
  VOICE_LIST_DOC,
  voiceList,
  voiceListFields,
  VOICES_PER_PAGE,
} from "./capabilities/voice/list.js";
export type { SearchDeps } from "./capabilities/web/search.js";
export { DEFAULT_RESULT_COUNT, renderSearchResults, webSearch, WEB_SEARCH_DOC, webSearchFields } from "./capabilities/web/search.js";

export type { FetchInitLike, FetchLike, FetchResponseLike } from "./http.js";
export { defaultFetch } from "./http.js";
export type { ExaOptions, SearchResult } from "./search/exa.js";
export { Exa } from "./search/exa.js";

export type { GeneratedMusic, GeminiMusicOptions, MusicBackend, MusicRequest } from "./media/music.js";
export { GeminiMusicGen, MUSIC_EXT_BY_MIME, parseMusic } from "./media/music.js";

export type { CutoutOptions, CutoutResult, CutoutTuning } from "./media/cutout.js";
export { cutout, DEFAULT_TUNING, tuningFromEnv } from "./media/cutout.js";

export type {
  GeneratedImage,
  ImageAspect,
  ImageBackend,
  ImageRequest,
  ImageSize,
  ImageSizeSpec,
} from "./media/image.js";
export {
  aspectMatches,
  extOf,
  higherTier,
  IMAGE_ASPECTS,
  IMAGE_EXTS,
  IMAGE_SIZES,
  imageSizeText,
  mimeForExt,
  parseImageSize,
  sizeOfImage,
  sniffImageMime,
  tierArea,
} from "./media/image.js";

export type { GeminiImageOptions } from "./media/gemini.js";
export { GeminiImageGen } from "./media/gemini.js";
export type { OpenAiImageOptions } from "./media/openai.js";
export { canvasFor as openAiCanvasFor, OpenAiImageGen } from "./media/openai.js";
export type { ModelsLabImageOptions } from "./media/modelslab.js";
export { canvasFor as modelsLabCanvasFor, ModelsLabImageGen } from "./media/modelslab.js";

export type { AssetIo, AssetKind, AssetManifest, AssetRef, LedgerEntry, LedgerKind } from "./media/catalog.js";
export {
  assetMetaOf,
  assetRel,
  declareBgmSource,
  declareDescription,
  declareSprite,
  existingAssetName,
  keepSpriteSource,
  ledgerEntryOf,
  ledgerIdOf,
  NEUTRAL,
  persistAsset,
  spriteSourceRel,
  staleSiblings,
} from "./media/catalog.js";
export type { AdoptedAsset, AdoptHost } from "./media/adopt.js";
export { adoptDraft } from "./media/adopt.js";
export type { DraftedDraft, DraftFiles, DraftPlan, DraftRecord } from "./media/draft.js";
export {
  DRAFT_TTL_MS,
  draftDir,
  draftsDir,
  loadDraft,
  markCommitted,
  newDraftId,
  pruneDrafts,
  readDraftImage,
  readDraftSource,
  writeDraft,
} from "./media/draft.js";

export type { AssetIndex } from "./media/asset-index.js";
export { listPlayAssets, MEDIA_EXT } from "./media/asset-index.js";
export {
  ACTOR_RULES,
  COMMENT_HEAD,
  CONTRACT_INTRO,
  DIALOGUE_TAGS,
} from "./prompt/stage-dsl.js";
export type { CastCardView, MemoryIndexCard } from "./prompt/a-zone.js";
export {
  AUDIO_RULES,
  castTitle,
  renderAssetSections,
  renderBareSprites,
  renderCastCard,
  renderMemoryIndex,
} from "./prompt/a-zone.js";
export type { PlayReadiness } from "./readiness/play.js";
export { readPlayReadiness, renderReadiness } from "./readiness/play.js";

export type { AssetCapabilities, CraftPatch, StopDirective } from "./craft/params.js";
export {
  CRAFT_ENUMS,
  describeCraftParams,
  mergeCraftParams,
  renderCraftParams,
} from "./craft/params.js";

export type { VoiceEntry } from "@aivn/core";
export type { VoiceJsonFetcher, VoiceQuery, VoiceSample, VoiceWindow } from "./voice/catalog.js";
export {
  fetchVoiceWindow,
  firstVoiceSample,
  MAX_PAGES as VOICE_MAX_PAGES,
  PAGE_SIZE as VOICE_PAGE_SIZE,
  readVoiceSample,
  toVoiceEntry,
  VoiceClient,
  VOICE_CACHE_TTL_MS,
  voiceQueryKey,
  voiceQuerySuffix,
  WINDOW_CACHE_LIMIT as VOICE_WINDOW_CACHE_LIMIT,
} from "./voice/catalog.js";

export type { KeyBackgroundColor } from "./media/prompt.js";
export {
  DEFAULT_KEY_COLOR,
  genericReferenceSuffix,
  isKeyBackgroundColor,
  KEY_BACKGROUND_COLORS,
  NEUTRAL_LEAD,
  referenceSuffix,
  spriteSuffix,
} from "./media/prompt.js";

export type { WebImage, WebImageFetcher, WebImageOptions } from "./media/web-image.js";
export { fetchWebImage, MAX_WEB_IMAGE_BYTES, readCapped, webImageBase } from "./media/web-image.js";
