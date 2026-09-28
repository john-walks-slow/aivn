import { useEffect, useRef } from "react";
import type { ScriptLine } from "./script.js";

interface StageViewProps {
  lines: readonly ScriptLine[];
  names: Readonly<Record<string, string>>;
  streaming: boolean;
  /** lines 版本号——lines 是原地变更的稳定引用，滚底 effect 以此驱动。 */
  revision: number;
}

/** 台词流视图：自动滚底、say/narrate/thought/scene 四种行型。 */
export function StageView({ lines, names, streaming, revision }: StageViewProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [revision, lines.length]);

  return (
    <main className="stage-view">
      {lines.map((line) => (
        <Line key={line.key} line={line} names={names} />
      ))}
      {streaming && <div className="stage-cursor" aria-hidden />}
      <div ref={bottomRef} />
    </main>
  );
}

function Line({ line, names }: { line: ScriptLine; names: Readonly<Record<string, string>> }) {
  switch (line.type) {
    case "scene":
      return (
        <div className="line line-scene">
          <span>◈ {line.text || "——"}</span>
        </div>
      );
    case "narrate":
      return <p className="line line-narrate">{line.text}</p>;
    case "thought":
      return (
        <p className="line line-thought">
          {names[line.actorId ?? ""] ?? line.actorId}：{line.text}
        </p>
      );
    case "say":
      return (
        <div className="line line-say">
          <span className="say-name">{names[line.actorId ?? ""] ?? line.actorId ?? "？"}</span>
          {line.mood && <span className="say-mood">（{line.mood}）</span>}
          <p className="say-text">{line.text}</p>
        </div>
      );
    default:
      return null;
  }
}
