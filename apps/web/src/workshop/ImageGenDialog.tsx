import { useEffect, useState } from "react";
import type { SpriteFraming } from "@aivn/core";
import { SPRITE_FRAMINGS, SPRITE_FRAMING_LABELS } from "@aivn/core";
import { api } from "../api.js";
import { Modal } from "../ui/Modal.js";
import { RefCharacterPicker, type RefCandidate } from "../ui/RefCharacterPicker.js";
import { toggleReference } from "../stage/cgOptions.js";

const STEM = /^[a-z][a-z0-9_]{0,39}$/;

export type ImageGenTarget =
  | {
      kind: "sprite";
      characterId: string;
      characterName: string;
      initialExpression?: string;
      initialFraming?: SpriteFraming;
      fixedExpression?: boolean;
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
    target.kind === "sprite"
      ? target.initialExpression ?? ""
      : target.initialName ?? "",
  );
  const [framing, setFraming] = useState<SpriteFraming>(
    target.kind === "sprite" ? target.initialFraming ?? "full" : "full",
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
      ? target.fixedExpression
        ? `重生成立绘：${target.characterName} / ${name}`
        : `生成新立绘：${target.characterName}`
      : target.kind === "background"
        ? "生成背景"
        : "生成 CG";

  const hint =
    target.kind === "sprite"
      ? "输入差分名与描述，服务端将组装提示词并异步出图。"
      : "输入素材名称与描述，可选参考角色立绘垫图。";

  const handleNameChange = (val: string) => {
    setName(val.toLowerCase().replace(/[^a-z0-9_]/g, ""));
    setError(null);
  };

  const canSubmit = (): boolean => {
    if (submitting) return false;
    if (result) return true; // 完成状态显示「完成」按钮
    const trimmed = name.trim();
    if (!trimmed) return false;
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

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.generateImage(playId, {
        kind: target.kind,
        name: target.kind !== "sprite" ? trimmed : undefined,
        characterId: target.kind === "sprite" ? target.characterId : undefined,
        expression: target.kind === "sprite" ? trimmed : undefined,
        framing: target.kind === "sprite" ? framing : undefined,
        referenceCharacters: target.kind !== "sprite" && selectedRefs.length > 0 ? selectedRefs : undefined,
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
                <span className="image-gen-label">差分名（a-z、数字、下划线）：</span>
                <input
                  value={name}
                  placeholder="如 smile、angry、neutral"
                  disabled={target.fixedExpression || submitting}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="image-gen-field">
                <span className="image-gen-label">取景与画幅：</span>
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
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="image-gen-field">
                <span className="image-gen-label">参考角色立绘（按点选顺序垫图）：</span>
                <RefCharacterPicker
                  candidates={refCandidates}
                  selected={selectedRefs}
                  onToggle={(id) => !submitting && setSelectedRefs((prev) => toggleReference(prev, id))}
                />
              </div>
            </>
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
