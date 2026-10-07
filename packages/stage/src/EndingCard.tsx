/**
 * 结局卡 —— 终局态的门面。
 *
 * 与 `StopPanel` 的关系是「同一种卡片、相反的语义」：StopPanel 是**玩家主权点**（选肢 / 自由输入 /
 * 继续），这张卡是**终点**——没有任何按钮，点了也不发生任何事。所以它复用舞台上既有的卡片视觉
 * （`.choice-overlay` 遮罩 + `.choice` 卡片基样式），另加 `.ending-*` 修饰类，而不是把停止点面板
 * 硬塞成一种假的 stopType。
 *
 * 卡的构成（对应 VN 媒介的 end slate）：主标题 + 副标题 + 收束散文。收束散文是结局之后**额外一轮**
 * 生成的（`<epilogue>`），还没到货时卡上先占一行提示，到了就地填进去。
 */

/** 结局本身的数据（`<ending id title subtitle/>` 的投影）。 */
export interface EndingCardData {
  id: string;
  title?: string;
  subtitle?: string;
}

interface EndingCardProps {
  ending: EndingCardData;
  /** 收束散文全文（`<epilogue>` 累积出来的）；空串 = 还没写出来。 */
  summary?: string;
  /** 收束散文正在生成：摆一行「剧作家正在写下结局……」的占位。 */
  summaryPending?: boolean;
}

/**
 * 浮层上的触摸要就地吃掉：舞台层监听着滑动手势（左右翻句、上滑看回顾），
 * 不拦的话在结局卡上滑一下就顺手把视图切走了（与 StopPanel 同一个理由）。
 */
const trap = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
  onTouchEnd: (e: React.TouchEvent) => e.stopPropagation(),
} as const;

export function EndingCard({ ending, summary = "", summaryPending = false }: EndingCardProps) {
  const title = ending.title?.trim() || ending.id;
  const hasSummary = summary.trim() !== "";
  return (
    <div className="choice-overlay ending-overlay" role="group" aria-label="结局" aria-live="polite" {...trap}>
      <div className="ending-card">
        <div className="ending-mark">— 剧终 —</div>
        <h2 className="ending-title">{title}</h2>
        {ending.subtitle ? <p className="ending-subtitle">{ending.subtitle}</p> : null}
        {hasSummary ? (
          <p className="ending-summary">{summary}</p>
        ) : summaryPending ? (
          <p className="ending-summary ending-summary-pending">剧作家正在写下结局……</p>
        ) : null}
      </div>
    </div>
  );
}
