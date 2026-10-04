import { Icon } from "../ui/Icon.js";

/**
 * 舞台左上角的常驻标识：此刻开着的几种模式各占一枚（限制级通道 / 静音 / 自动）。
 *
 * 只报状态，不做开关——语音与自动的开关在对话框右下角那一排，这里再摆一份就是
 * 同一个动作两个控件。三种模式全关时整行不渲染：常驻的空行只是给画面添 chrome。
 *
 * 无边框、无底色的一行淡痕压在画面上：它是 HUD，不是一块面板（面板的样式归排队面板）。
 * 限制级那枚没有对应的字形，直接用 NSFW 四个字母当它的记号；可读名一律交给 title。
 */
export function StageModes({
  nsfw,
  muted,
  auto,
}: {
  /** 限制级（NSFW）剧情通道开着。 */
  nsfw: boolean;
  /** 语音关着（本剧目有 TTS 能力、用户把它关了）。 */
  muted: boolean;
  /** 自动播放开着。 */
  auto: boolean;
}) {
  if (!nsfw && !muted && !auto) return null;
  return (
    <div className="stage-modes">
      {nsfw && (
        <span className="stage-mode stage-mode-nsfw" title="限制级通道">
          NSFW
        </span>
      )}
      {muted && (
        <span className="stage-mode" title="静音">
          <Icon name="volume-off" size={14} />
        </span>
      )}
      {auto && (
        <span className="stage-mode" title="自动播放">
          <Icon name="play" size={14} />
        </span>
      )}
    </div>
  );
}
