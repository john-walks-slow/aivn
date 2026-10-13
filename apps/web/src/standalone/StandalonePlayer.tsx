import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unzipSync } from "fflate";
import {
  LineageTree,
  lineageToEvents,
  parseCharacterCard,
  parsePlayConfig,
  type CharacterDocument,
  type PlayConfig,
  type SequencedEvent,
} from "@aivn/core";
import {
  StageTheater,
  ScriptBuilder,
  buildAssetIndex,
  buildTranscript,
  usePlayback,
  VoiceDirector,
  type AssetIndex,
  type DirectorTargets,
  type VoiceState,
} from "@aivn/stage";

function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

interface LoadedData {
  play: PlayConfig;
  tree: LineageTree;
  index: AssetIndex;
  voiceMap: Record<number, string>;
  voiceCast: Set<string>;
  names: Record<string, string>;
  rawFiles: Record<string, Uint8Array>;
  blobUrls: Map<string, string>;
}

const EMPTY_TARGETS: DirectorTargets = {
  beatId: null,
  beatNodeId: null,
  lineNodeId: null,
  lineSeq: null,
  lineText: "",
};

export function StandalonePlayer() {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [currentLeafId, setCurrentLeafId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 语音总开关与导演引用
  const [voiceOn, setVoiceOn] = useState(true);
  const [turbo, setTurbo] = useState(false);
  const voiceDirectorRef = useRef<VoiceDirector | null>(null);

  // 1. 初始化：从 #aivn-data 读取 Base64 并解压
  useEffect(() => {
    try {
      const el = document.getElementById("aivn-data");
      const base64 = el?.textContent?.trim();
      if (!base64) {
        throw new Error("未找到剧目归档数据（#aivn-data）");
      }
      const rawBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const files = unzipSync(rawBytes);

      // 解析 play.json
      const playRaw = files["play.json"];
      if (!playRaw) throw new Error("归档缺少 play.json");
      const play = parsePlayConfig(JSON.parse(new TextDecoder().decode(playRaw)));

      // 解析 session.json 里的谱系树
      const sessionRaw = files["session.json"];
      if (!sessionRaw) throw new Error("归档缺少 session.json");
      const session = JSON.parse(new TextDecoder().decode(sessionRaw));

      const tree = new LineageTree();
      tree.load(session.lineage);

      // 解析 voiceMap.json
      let voiceMap: Record<number, string> = {};
      const vmRaw = files["voiceMap.json"];
      if (vmRaw) {
        try {
          voiceMap = JSON.parse(new TextDecoder().decode(vmRaw));
        } catch {}
      }

      // 创建所有素材的 Blob URL 并分类索引
      const blobUrls = new Map<string, string>();
      const assetCategories: Record<string, string[]> = {
        backgrounds: [],
        cg: [],
        bgm: [],
        ambient: [],
        sfx: [],
      };

      for (const [path, bytes] of Object.entries(files)) {
        if (path.startsWith("assets/") || path.startsWith("media-cache/")) {
          const blob = new Blob([bytes], { type: mimeOf(path) });
          blobUrls.set(path, URL.createObjectURL(blob));

          if (path.startsWith("assets/")) {
            const rel = path.slice("assets/".length);
            if (rel.startsWith("sprites/")) {
              const sub = rel.slice("sprites/".length);
              const slash = sub.indexOf("/");
              if (slash > 0) {
                const spriteId = sub.slice(0, slash);
                const file = sub.slice(slash + 1);
                const key = `sprites/${spriteId}`;
                if (!assetCategories[key]) assetCategories[key] = [];
                assetCategories[key].push(file);
              }
            } else {
              const slash = rel.indexOf("/");
              if (slash > 0) {
                const cat = rel.slice(0, slash);
                const file = rel.slice(slash + 1);
                if (assetCategories[cat]) {
                  assetCategories[cat].push(file);
                }
              }
            }
          }
        }
      }

      // 解析角色卡
      const cast: CharacterDocument[] = [];
      const voiceCast = new Set<string>();
      const names: Record<string, string> = {};

      for (const [path, bytes] of Object.entries(files)) {
        if (path.startsWith("characters/") && path.endsWith(".md")) {
          const text = new TextDecoder().decode(bytes);
          const parsed = parseCharacterCard(text);
          if (parsed) {
            const id = path.slice("characters/".length, -".md".length);
            cast.push({ id, ...parsed });
            names[id] = parsed.name || id;
            if (parsed.voiceId) {
              voiceCast.add(id);
            }
          }
        }
      }

      // 解析 manifest.json
      let manifest: any = {};
      const mfRaw = files["assets/manifest.json"];
      if (mfRaw) {
        try {
          manifest = JSON.parse(new TextDecoder().decode(mfRaw));
        } catch {}
      }

      const index = buildAssetIndex(play.id, assetCategories, {}, manifest, cast, {
        assetUrl: (rel) => blobUrls.get(`assets/${rel}`) ?? "",
      });

      // 初始化语音导演并注入已有配音
      const vd = new VoiceDirector();
      for (const [seqStr, ttsPath] of Object.entries(voiceMap)) {
        const seq = Number(seqStr);
        const url = blobUrls.get(ttsPath);
        if (url) {
          vd.handleAudio({ seq, url });
        }
      }
      voiceDirectorRef.current = vd;

      setData({
        play,
        tree,
        index,
        voiceMap,
        voiceCast,
        names,
        rawFiles: files,
        blobUrls,
      });
      setCurrentLeafId(tree.leafId);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }, []);

  // 2. 根据当前世界线叶子物化事件流与剧本
  const { lines, cues, transcript, stopNode } = useMemo(() => {
    if (!data || !currentLeafId) {
      return { lines: [], cues: [], transcript: [], stopNode: null };
    }
    const tree = data.tree;
    // 找出通往当前叶子的路径节点
    const views = tree.describe().nodes;
    const pathIds = new Set(tree.ancestorChain(currentLeafId));
    const pathViews = views.filter((v) => pathIds.has(v.id));

    const events: SequencedEvent[] = lineageToEvents(pathViews);
    const builder = new ScriptBuilder();
    for (const item of events) {
      builder.apply(item.event, item.seq);
    }

    const t = buildTranscript(tree.describe(), builder.lines);
    // 找最后一个 stop 节点
    let lastStop: any = null;
    for (let i = pathViews.length - 1; i >= 0; i--) {
      if (pathViews[i]?.kind === "stop") {
        lastStop = pathViews[i];
        break;
      }
    }
    return {
      lines: builder.lines,
      cues: builder.cues,
      transcript: t,
      stopNode: lastStop,
    };
  }, [data, currentLeafId]);

  // 3. 驱动播放状态机
  const playback = usePlayback(cues, lines, {
    live: false,
    resume: false,
    revision: 0,
    transcript,
    turbo,
    onLineStart: (line) => {
      if (voiceOn && voiceDirectorRef.current) {
        voiceDirectorRef.current.lineStarted(line?.seq, line?.type === "say");
      }
    },
    onFastForward: () => voiceDirectorRef.current?.fastForward(),
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const voiceState = useCallback((seq: number | null): VoiceState => {
    if (!seq || !voiceDirectorRef.current) return "none";
    return voiceDirectorRef.current.voiceState(seq);
  }, []);

  const replayVoice = useCallback((seq: number) => {
    voiceDirectorRef.current?.requestReplay(seq);
  }, []);

  const unlockAudio = useCallback(() => {
    voiceDirectorRef.current?.unlock();
    setStarted(true);
  }, []);

  // 4. 分支选项点击
  const handleSelectOption = useCallback(
    (optionText: string) => {
      if (!data || !stopNode) return;
      const tree = data.tree;
      const allNodes = tree.describe().nodes;

      // 寻找挂在当前 stop 节点后且文本匹配的分支子节点
      const child = allNodes.find(
        (n) =>
          n.parentId === stopNode.id &&
          (n.text.includes(optionText) || optionText.includes(n.text) || n.kind === "prompt"),
      );

      if (child) {
        // 顺着该分支找到它末尾的叶子节点
        const findDeepest = (parentId: string): string => {
          const next = allNodes.find((n) => n.parentId === parentId);
          return next ? findDeepest(next.id) : parentId;
        };
        const leaf = findDeepest(child.id);
        setCurrentLeafId(leaf);
        showToast("已切换至该世界线分支");
      } else {
        showToast("该分支在本次导出中尚未生成。导入 Stage AI 即可继续开演！");
      }
    },
    [data, stopNode, showToast],
  );

  if (error) {
    return (
      <div className="standalone-error-screen">
        <div className="standalone-card">
          <h2>演出数据加载失败</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="standalone-loading-screen">
        <div className="standalone-loading-spinner" />
        <p>正在解压演出资源…</p>
      </div>
    );
  }

  // 首屏点击开始遮罩（解锁音频 AudioContext）
  if (!started) {
    return (
      <div className="standalone-start-screen" onClick={unlockAudio}>
        <div className="standalone-title-card">
          <h1 className="standalone-play-title">{data.play.title}</h1>
          <p className="standalone-play-opening">{data.play.opening}</p>
          <button type="button" className="standalone-start-btn" onClick={unlockAudio}>
            点击开启演出
          </button>
          <span className="standalone-subtext">无需网络 · 包含完整声画与分支</span>
        </div>
      </div>
    );
  }

  // 判断是否演到了末尾的选项分支
  const isAtStop = playback.exhausted && stopNode && stopNode.stopOptions && stopNode.stopOptions.length > 0;

  return (
    <div className="screen stage-screen standalone-player">
      <StageTheater
        visual={playback.visual}
        playback={playback}
        live={false}
        loading={false}
        fresh={false}
        names={data.names}
        voiceCast={data.voiceCast}
        index={data.index}
        voiceAvailable={true}
        voiceOn={voiceOn}
        onToggleVoice={() => setVoiceOn((v) => !v)}
        busy={false}
        targets={EMPTY_TARGETS}
        onView={() => {}}
        availableViews={["stage"]}
        onPrompt={() => {}}
        onFork={() => {}}
        onEdit={() => {}}
        onGenerateCg={() => {}}
        onReplay={replayVoice}
        voiceState={voiceState}
        onUnlock={unlockAudio}
        onTurbo={setTurbo}
        canContinue={false}
        onContinue={() => {}}
        onNotify={showToast}
        overlay={
          isAtStop ? (
            <div className="choice-overlay" role="group" aria-label="分支选择">
              {stopNode.stopOptions.map((opt: any, idx: number) => {
                const text = typeof opt === "string" ? opt : opt.text;
                return (
                  <button
                    key={idx}
                    type="button"
                    className="choice"
                    onClick={() => handleSelectOption(text)}
                  >
                    <span className="choice-num">{idx + 1}</span>
                    <span className="choice-text">{text}</span>
                  </button>
                );
              })}
            </div>
          ) : null
        }
      />

      {toast && (
        <div className="standalone-toast-banner">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
