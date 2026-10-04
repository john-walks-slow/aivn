import { useEffect, useState } from "react";
import type { SpriteFraming, SpriteStature } from "@aivn/core";
import { SPRITE_FRAMINGS, SPRITE_FRAMING_LABELS, SPRITE_STATURES, SPRITE_STATURE_LABELS } from "@aivn/core";
import { api } from "../api.js";
import { Modal } from "../ui/Modal.js";
import { RefCharacterPicker, type RefCandidate } from "../ui/RefCharacterPicker.js";
import { toggleReference } from "../stage/cgOptions.js";

const STEM = /^[a-z][a-z0-9_]{0,39}$/;

export type ImageGenTarget =
  | {
      kind: "sprite";
      /** 立绘 id（= 目录名）。空串 = 新建一张，对话框里现填。 */
      spriteId: string;
      /** 名牌：无卡主体用（有卡时卡上的 name 优先）。 */
      spriteTitle?: string;
      /** 差分名初值；`fixedVariant` 为真时锁死（重生成某条已有差分）。 */
      initialVariant?: string;
      fixedVariant?: boolean;
      initialFraming?: SpriteFraming;
      initialStature?: SpriteStature;
    }
  | {
      kind: "background";
      initialName?: string;
    }
  | {
      kind: "cg";
      initialName?: string;
    };

export interface ImageResultEvent {
  target: string;
  ok: boolean;
  url?: string;
  path?: string;
  message?: string;
}

export function ImageGenDialog({
  playId,
  target,
  refCandidates = [],
  subscribeImageResult,
  onClose,
  onDone,
}: {
  playId: string;
  target: ImageGenTarget;
  refCandidates?: RefCandidate[];
  subscribeImageResult?: (handler: (res: any) => void) => () => void;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [name, setName] = useState(
    target.kind === "sprite" ? target.initialVariant ?? "" : target.initialName ?? "",
  );
  /** 立绘 id：新建时（给的是空串）在这里现填，与角色卡同名即绑定。 */
  const [spriteId, setSpriteId] = useState(target.kind === "sprite" ? target.spriteId : "");
  const [framing, setFraming] = useState<SpriteFraming>(
    target.kind === "sprite" ? target.initialFraming ?? "full" : "full",
  );
  const [stature, setStature] = useState<SpriteStature>(
    target.kind === "sprite" ? target.initialStature ?? "normal" : "normal",
  );
  const [instruction, setInstruction] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [waitingTarget, setWaitingTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; path: string } | null>(null);

  // 监听生图结果广播
  useEffect(() => {
    if (!subscribeImageResult || !waitingTarget) return;
    const unsubscribe = subscribeImageResult((msg: ImageResultEvent) => {
      if (msg.target !== waitingTarget) return;
      setSubmitting(false);
      if (msg.ok && msg.url && msg.path) {
        setResult({ url: msg.url, path: msg.path });
        onDone?.();
      } else {
        setError(msg.message ?? "生图失败");
      }
    });
    return unsubscribe;
  }, [subscribeImageResult, waitingTarget, onDone]);

  const title =
    target.kind === "sprite"
      ? target.fixedVariant
        ? `重生成立绘：${spriteId} / ${name}`
        : `生成立绘：${spriteId || "新主体"}`
      : target.kind === "background"
        ? "生成背景"
        : "生成 CG";

  const hint =
    target.kind === "sprite"
      ? "填立绘 id 与差分名。同名角色卡有人设时一并喂给模型，没有卡只按你的描述出。"
      : "输入素材名称与描述，可选参考立绘垫图。";

  /** 输入框只收合法字符，非法字符当场吃掉（本体仍按 STEM 校一遍，给出解释而不是静默） */
  const cleanStem = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_]/g, "");

  /**
   * 谁能垫参考图：背景/CG 随时可以，立绘只有 `neutral` 定妆照可以——
   * 那是这个主体的**身份基准**，从别的图起手是它的正当用法；差分吃的是自己主体的
   * neutral，换基准会与既有差分不是同一个人，所以服务端直接拒。
   */
  const canPickRefs = target.kind !== "sprite" || name.trim() === "neutral";

  const canSubmit = (): boolean => {
    if (submitting) return false;
    if (result) return true; // 完成状态显示「完成」按钮
    if (!name.trim()) return false;
    if (target.kind === "sprite" && !spriteId.trim()) return false;
    return true;
  };

  const submit = async () => {
    if (result) {
      onClose();
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError(target.kind === "sprite" ? "请填写差分名" : "请填写素材名");
      return;
    }
    if (!STEM.test(trimmed)) {
      setError("名称只允许小写字母开头的 a-z、数字、下划线，最长 40 字符");
      return;
    }
    const id = spriteId.trim();
    if (target.kind === "sprite") {
      if (!id) {
        setError("请填写立绘 id（目录名）");
        return;
      }
      if (!STEM.test(id)) {
        setError("立绘 id 只允许小写字母开头的 a-z、数字、下划线，最长 40 字符");
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.generateImage(playId, {
        kind: target.kind,
        name: target.kind !== "sprite" ? trimmed : undefined,
        spriteId: target.kind === "sprite" ? id : undefined,
        variant: target.kind === "sprite" ? trimmed : undefined,
        framing: target.kind === "sprite" ? framing : undefined,
        stature: target.kind === "sprite" ? stature : undefined,
        title: target.kind === "sprite" ? target.spriteTitle : undefined,
        referenceCharacters: canPickRefs && selectedRefs.length > 0 ? selectedRefs : undefined,
        instruction: instruction.trim() || undefined,
      });
      setWaitingTarget(res.target);
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal
      title={title}
      hint={hint}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="primary"
            onClick={submit}
            disabled={!canSubmit()}
          >
            {result ? "完成" : submitting ? "生成中（预计 1~2 分钟）…" : "发起生成"}
          </button>
          <button type="button" className="ghost-btn" onClick={onClose} disabled={submitting && !result}>
            {result ? "关闭" : "取消"}
          </button>
        </>
      }
    >
      {error && (
        <div className="error-banner small" role="alert">
          {error}
        </div>
      )}

      {result ? (
        <div className="image-gen-result-card">
          <img src={result.url} alt="生成结果" />
          <div className="muted small">已保存至 <code>{result.path}</code></div>
        </div>
      ) : (
        <div className="modal-body">
          {target.kind === "sprite" ? (
            <>
              <div className="image-gen-field">
                <span className="image-gen-label">立绘 id（谁/什么，与角色卡同名即绑定）：</span>
                <input
                  value={spriteId}
                  placeholder="如 xiaoyu、mecha_01、cat"
                  disabled={target.spriteId !== "" || submitting}
                  onChange={(e) => {
                    setSpriteId(cleanStem(e.target.value));
                    setError(null);
                  }}
                />
              </div>
              <div className="image-gen-field">
                <span className="image-gen-label">差分名（a-z、数字、下划线）：</span>
                <input
                  value={name}
                  placeholder="如 smile、angry、neutral"
                  disabled={target.fixedVariant || submitting}
                  onChange={(e) => {
                    setName(cleanStem(e.target.value));
                    setError(null);
                  }}
                />
              </div>
              <div className="image-gen-field">
                <span className="image-gen-label">取景与体量：</span>
                <select
                  value={framing}
                  disabled={submitting}
                  onChange={(e) => setFraming(e.target.value as SpriteFraming)}
                >
                  {SPRITE_FRAMINGS.map((f) => (
                    <option key={f} value={f}>
                      {SPRITE_FRAMING_LABELS[f]}
                    </option>
                  ))}
                </select>
                <select
                  value={stature}
                  disabled={submitting}
                  onChange={(e) => setStature(e.target.value as SpriteStature)}
                >
                  {SPRITE_STATURES.map((s) => (
                    <option key={s} value={s}>
                      {SPRITE_STATURE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="image-gen-field">
                <span className="image-gen-label">素材名称（id，a-z、数字、下划线）：</span>
                <input
                  value={name}
                  placeholder={target.kind === "background" ? "如 classroom_sunset" : "如 rooftop_kiss"}
                  disabled={submitting}
                  onChange={(e) => {
                    setName(cleanStem(e.target.value));
                    setError(null);
                  }}
                />
              </div>
            </>
          )}

          {canPickRefs && (
            <div className="image-gen-field">
              <span className="image-gen-label">参考立绘（按点选顺序垫图）：</span>
              <RefCharacterPicker
                candidates={refCandidates}
                selected={selectedRefs}
                onToggle={(id) => !submitting && setSelectedRefs((prev) => toggleReference(prev, id))}
              />
            </div>
          )}

          <div className="image-gen-field">
            <span className="image-gen-label">画面要求 / 描述（可选）：</span>
            <textarea
              rows={3}
              value={instruction}
              disabled={submitting}
              placeholder={
                target.kind === "sprite"
                  ? "描述想要的神态、手势或微表情，留空则由模型自由发挥…"
                  : "描述场景天气、光影、画面细节等…"
              }
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          {submitting && (
            <div className="muted small" style={{ textAlign: "center", padding: "8px 0" }}>
              AI 正在绘制并抠底处理中，请稍候（不会阻塞其他操作）…
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
