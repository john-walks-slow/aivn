// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayback, buildTranscript, type TranscriptEntry, type Cue, type ScriptLine } from "@aivn/stage";

/**
 * 选完选项后的回执流：player_input 事件落进缓冲 → 播放头还停在上一句（已读完）→
 * 回执行入队即显示（不等点击），新一轮首句进场后照常让位、进回顾。
 * 这是回声层删除后「立刻看见自己说了什么」的唯一保证，照 StageScreen 的接法整段接起来测：
 * 缓冲数组原地生长 + revision 递增，同一个组件实例走完。
 * 时序按服务端真实顺序：player_input 先于 beat_start 到达——回执行进队那一刻
 * state 还停在 stopped（live=false），回执必须照样显示，不能等 beat_start 翻真。
 */

type Playback = ReturnType<typeof usePlayback>;

function Harness({
  cues,
  lines,
  live,
  revision,
  latest,
}: {
  cues: Cue[];
  lines: ScriptLine[];
  live: boolean;
  revision: number;
  latest: { current: Playback | null };
}) {
  const transcript: TranscriptEntry[] = buildTranscript(null, lines);
  const playback = usePlayback(cues, lines, { live, resume: false, revision, transcript });
  latest.current = playback;
  return null;
}

afterEach(cleanup);

/** 走到停止点：上一句点开读完（二段式第二下把整行翻完），队列消费到头。 */
async function readToStop(
  rerender: (ui: React.ReactElement) => void,
  store: { cues: Cue[]; lines: ScriptLine[] },
  latest: { current: Playback | null },
): Promise<void> {
  rerender(<Harness {...store} live={false} revision={1} latest={latest} />);
  await act(async () => {
    latest.current!.advance(); // 点开这一句
  });
  await act(async () => {
    latest.current!.advance(); // 读完（整行翻完）
  });
  expect(latest.current!.current?.key).toBe("l1");
  expect(latest.current!.exhausted).toBe(true);
}

describe("玩家回执的起播", () => {
  it("回执行入队即显示：不等点击、不等 beat_start（state 还停在 stopped）", async () => {
    const store = {
      cues: [{ key: "c0", kind: "line", lineKey: "l1" }] as Cue[],
      lines: [{ key: "l1", type: "say", actorId: "yu", text: "……太慢了！", seq: 1 }] as ScriptLine[],
    };
    const latest: { current: Playback | null } = { current: null };

    const { rerender } = render(<Harness {...store} live={false} revision={0} latest={latest} />);
    await readToStop(rerender, store, latest);

    // 选项被接受：player_input 进缓冲（原地生长）。beat_start 还没到，live 仍是 false——
    // 回执不能看它的脸色，否则遇到生成慢/起拍失败时界面就冻在上一句上。
    store.cues.push({ key: "c1", kind: "line", lineKey: "l2" });
    store.lines.push({ key: "l2", type: "input", actorId: "player", text: "（选择了：道歉）", seq: 2 });
    rerender(<Harness {...store} live={false} revision={2} latest={latest} />);

    // 起播例外在 80ms 定时器后消费回执行；整行显示（无打字机）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(latest.current!.current?.key).toBe("l2");
    expect(latest.current!.view).toMatchObject({ kind: "input", actorId: "player", text: "（选择了：道歉）" });
    expect(latest.current!.shownLength).toBe("（选择了：道歉）".length);
  });

  it("自动模式不拦自己的话：回执不吃读速节奏那 2~3 秒延迟", async () => {
    const store = {
      cues: [{ key: "c0", kind: "line", lineKey: "l1" }] as Cue[],
      lines: [{ key: "l1", type: "say", actorId: "yu", text: "……太慢了！", seq: 1 }] as ScriptLine[],
    };
    const latest: { current: Playback | null } = { current: null };

    const { rerender } = render(<Harness {...store} live={false} revision={0} latest={latest} />);
    await readToStop(rerender, store, latest);
    await act(async () => {
      latest.current!.setAuto(true);
    });
    expect(latest.current!.auto).toBe(true);

    store.cues.push({ key: "c1", kind: "line", lineKey: "l2" });
    store.lines.push({ key: "l2", type: "input", actorId: "player", text: "（选择了：道歉）", seq: 2 });
    rerender(<Harness {...store} live={false} revision={2} latest={latest} />);

    // Auto 的读速延迟是 900 + 字数×55ms（这里 ≈1.3s）：250ms 内显示了，
    // 走的必然是回执例外，不是自动模式的节奏。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(latest.current!.current?.key).toBe("l2");
    expect(latest.current!.shownLength).toBe("（选择了：道歉）".length);
  });

  it("新一轮首句进场后回执照常让位（成为回顾里的一条）", async () => {
    const store = {
      cues: [{ key: "c0", kind: "line", lineKey: "l1" }] as Cue[],
      lines: [{ key: "l1", type: "say", actorId: "yu", text: "……太慢了！", seq: 1 }] as ScriptLine[],
    };
    const latest: { current: Playback | null } = { current: null };

    const { rerender } = render(<Harness {...store} live={false} revision={0} latest={latest} />);
    await readToStop(rerender, store, latest);

    store.cues.push({ key: "c1", kind: "line", lineKey: "l2" });
    store.lines.push({ key: "l2", type: "input", actorId: "player", text: "（选择了：道歉）", seq: 2 });
    rerender(<Harness {...store} live={false} revision={2} latest={latest} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(latest.current!.current?.key).toBe("l2");

    // 新一轮的首句到了（beat_start 已翻真）：玩家点一下，回执让位
    store.cues.push({ key: "c2", kind: "line", lineKey: "l3" });
    store.lines.push({ key: "l3", type: "say", actorId: "yu", text: "……算了。", seq: 3 });
    rerender(<Harness {...store} live={true} revision={3} latest={latest} />);
    await act(async () => {
      latest.current!.advance();
    });
    expect(latest.current!.current?.key).toBe("l3");
    // 回执进了回顾（播放头之前说过的话），没有丢
    expect(latest.current!.history.map((e) => [e.kind, e.text])).toContainEqual([
      "input",
      "（选择了：道歉）",
    ]);
  });
});
