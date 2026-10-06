import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { HistoryBeat, HistoryEntry } from "../api.js";

/** 历史条目的呈现分工：正文一个样式，思考/原始 DSL 走等宽体（它们不是台词）。 */
const HISTORY_KIND: Record<HistoryEntry["role"], { label: string; cls: string }> = {
  user: { label: "注入上下文", cls: "hx-user" },
  thinking: { label: "剧作家思考", cls: "hx-thinking" },
  assistant: { label: "原始 DSL（未解析）", cls: "hx-dsl" },
  toolCall: { label: "工具调用", cls: "hx-tool" },
};

/**
 * 剧作家原始历史：活动周目最近若干轮的 session 快照（REST 只读，不建 runtime、不改状态）。
 * 与回顾互补——回顾只给解析后的台词与选肢，这里给写出来之前的原文：注入上下文、
 * 思考、未经解析的原始 DSL、工具调用。空表不是错误：还没落盘（读盘落后一轮）
 * 或纪元压缩前没有留存。标题条由外层 BacklogView 统一给，这里只出内容。
 */
export function HistoryView({ playId, nonce }: { playId: string; nonce: number }) {
  const [beats, setBeats] = useState<HistoryBeat[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .history(playId)
      .then((r) => alive && setBeats(r.beats))
      .catch(() => alive && setBeats([]));
    return () => {
      alive = false;
    };
  }, [playId, nonce]);

  if (beats === null) return <div className="overlay">读取历史…</div>;
  if (beats.length === 0) {
    return <p className="backlog-empty">还没有留存的历史——生成完就写进来了。</p>;
  }
  return (
    <div className="backlog-panel">
      {beats === null ? (
        <div className="overlay">读取历史…</div>
      ) : beats.length === 0 ? (
        <p className="backlog-empty">还没有留存的历史——生成完就写进来了。</p>
      ) : (
        <>
          {beats.map((beat) => (
            <section key={beat.turn} className="hx-beat">
              <header className="hx-beat-head">
                <span>第 {beat.turn} 次生成</span>
                <span className="muted">{beat.entries.length} 条</span>
              </header>
              {beat.entries.map((entry) => {
                const kind = HISTORY_KIND[entry.role];
                return (
                  <div key={`${entry.beat}-${entry.seq}`} className={`hx-entry ${kind.cls}`}>
                    <span className="hx-kind">
                      {kind.label}
                      {entry.role === "toolCall" && entry.name ? ` · ${entry.name}` : ""}
                    </span>
                    {entry.role === "toolCall" ? (
                      <pre className="hx-tool">{JSON.stringify(entry.args ?? {}, null, 2)}</pre>
                    ) : (
                      <p className="hx-text">{entry.text}</p>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          <p className="muted hx-foot">只读快照，落盘比当前轮慢一步——要最新的按侧栏的「刷新」。</p>
        </>
      )}
    </div>
  );
}
