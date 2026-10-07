/**
 * @aivn/stage 的桶文件：画面（舞台视觉层）、台词条、停止点、播放与音频，
 * 加上它们共用的 UI 基座。宿主只需要这一层就能渲染并播一出戏。
 *
 * 路线树 / 回顾 / 工坊 / 存档页是 app 自己的东西，不在这个包里。
 */

export { StageTheater, BacklogView } from "./StageTheater.js";
export type { DirectorTargets, VoiceState } from "./StageTheater.js";

export { StopPanel } from "./StopPanel.js";
export { EndingCard } from "./EndingCard.js";
export type { EndingCardData } from "./EndingCard.js";
export { StageModes } from "./StageModes.js";
export { ToastStack, useToasts } from "./toast.js";
export type { Toast, ToastKind, Toaster } from "./toast.js";

export {
  applyActorCue,
  applyCue,
  applyVisualCue,
  cueWatermarkForEntry,
  displayedNodeId,
  lineCueIndexAt,
  lineCueIndexByNodeId,
  pendingTtlMs,
  resolveAudio,
  resolveResumeSeek,
  speakerFocusId,
  usePlayback,
  visualAt,
  withAttachedCg,
} from "./director.js";
export type { Playback, PlaybackHooks, ResumeSeek, SpriteSlot, VisualState } from "./director.js";

export { dialogContent, emptyDialogHint, shouldAutoStart, stopAffordance } from "./playbackState.js";
export type { AutoStartInput, DialogInput, StopAffordance, StopAffordanceInput } from "./playbackState.js";

export { LoopChannel, SfxPlayer } from "./loopAudio.js";
export { VoiceDirector } from "./audio.js";

export { ScriptBuilder, actorName } from "./script.js";
export type { Cue, ScriptLine } from "./script.js";

export { buildAssetIndex } from "./assets.js";
export type { AssetIndex, AssetIndexOptions, SpritePresentation } from "./assets.js";

export { buildTranscript, editableNodeId } from "./transcript.js";
export type { TranscriptEntry, TranscriptKind } from "./transcript.js";

export { useGeneratedAssets } from "./generatedAssets.js";
export type { GeneratedImage } from "./generatedAssets.js";

export { useVisualViewport } from "./viewport.js";

export {
  VIEW_LABEL,
  stageTabFromQuery,
  stageViewFromQuery,
  workshopConnectionFromQuery,
  workshopUrl,
} from "./view.js";
export type { StageView, WorkshopTab } from "./view.js";

export { SETTING_CONTINUE_CARD, SETTING_VOICE, readFlag, writeFlag } from "./settings.js";
export { cgCanSubmit, toggleReference } from "./cgOptions.js";

export { Icon } from "./ui/Icon.js";
export type { IconName } from "./ui/Icon.js";
export { Modal } from "./ui/Modal.js";
export { escapeClaimed, useEscape } from "./ui/escape.js";
export { stamp } from "./ui/stamp.js";
export { RefCharacterPicker } from "./ui/RefCharacterPicker.js";
export type { RefCandidate } from "./ui/RefCharacterPicker.js";
