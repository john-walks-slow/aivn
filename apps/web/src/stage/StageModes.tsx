/**
 * 舞台左上角的常驻标识：此刻开着的几种模式各占一枚（限制级通道 / 静音 / 自动）。
 *
 * 只报状态，不做开关——语音与自动的开关在对话框右下角那一排，这里再摆一份就是
 * 同一个动作两个控件。三种模式全关时整行不渲染：常驻的空行只是给画面添 chrome。
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
  const modes = [
    ...(nsfw ? ["限制级通道"] : []),
    ...(muted ? ["静音"] : []),
    ...(auto ? ["自动"] : []),
  ];
  if (modes.length === 0) return null;
  return (
    <div className="stage-modes" aria-label="当前模式">
      {modes.map((mode) => (
        <span key={mode} className="stage-mode">
          {mode}
        </span>
      ))}
    </div>
  );
}
