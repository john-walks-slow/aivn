import { useEffect, useMemo, useRef, useState } from "react";
import type { SpriteFraming, SpriteStature } from "@aivn/core";
import {
  SPRITE_FRAMINGS,
  SPRITE_FRAMING_LABELS,
  SPRITE_STATURES,
  SPRITE_STATURE_LABELS,
  spriteVariantChoices,
} from "@aivn/core";
import { api } from "../api.js";
import { Modal, RefCharacterPicker, type RefCandidate, toggleReference } from "@aivn/stage";

const STEM = /^[a-z][a-z0-9_]{0,39}$/;
const NEUTRAL = "neutral";

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
      /** 一批差分：差分名改成多选清单，逐个提交（取景/体量/画面要求整批共用）。 */
      variantsBatch?: boolean;
    }
  | {
      kind: "background";
      initialName?: string;
    }
  | {
      kind: "cg";
      initialName?: string;
    };

/** 该主体目录的现状：差分名与 neutral 定妆照地址。差分恒以 neutral 垫图，界面得说出来是谁。 */
export interface SpriteDirState {
  variants: string[];
  neutralUrl?: string;
}

export interface ImageResultEvent {
  target: string;
  ok: boolean;
  url?: string;
  path?: string;
  message?: string;
}

/** 批量模式下的一条：受理成功就等广播，受理就失败就当场标红。 */
interface BatchJob {
  variant: string;
  /** 受理成功后才知道的 target（`sprites/<id>/<variant>`），WS 回执按它认领。 */
  target: string | null;
  status: "submitting" | "waiting" | "done" | "failed";
  url?: string;
  path?: string;
  message?: string;
}

export function ImageGenDialog({
  playId,
  target,
  spriteDir,
  refCandidates = [],
  subscribeImageResult,
  onClose,
  onDone,
}: {
  playId: string;
  target: ImageGenTarget;
  spriteDir?: SpriteDirState;
  refCandidates?: RefCandidate[];
  subscribeImageResult?: (handler: (res: any) => void) => () => void;
  onClose: () => void;
  onDone?: () => void;
}) {
  const batch = target.kind === "sprite" && target.variantsBatch === true;
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
  /** 批量：待生成清单与逐张进度。 */
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [jobs, setJobs] = useState<BatchJob[]>([]);

  const pending = jobs.filter((job) => job.status === "submitting" || job.status === "waiting").length;
  const hasPending = pending > 0;
  const started = batch && jobs.length > 0;
  const failedVariants = jobs.filter((job) => job.status === "failed").map((job) => job.variant);
  /** 广播回调里要按「当前这批」认领，不能读闭包里的 jobs（那是订阅那一刻的快照）。 */
  const jobsRef = useRef<BatchJob[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // 监听生图结果广播：单张等它那一个 target，批量逐条认领自己那一张。
  useEffect(() => {
    if (!subscribeImageResult) return;
    if (!waitingTarget && !hasPending) return;
    const unsubscribe = subscribeImageResult((msg: ImageResultEvent) => {
      if (msg.target === waitingTarget) {
        setSubmitting(false);
        if (msg.ok && msg.url && msg.path) {
          setResult({ url: msg.url, path: msg.path });
          onDone?.();
        } else {
          setError(msg.message ?? "生图失败");
        }
        return;
      }
      // 不是这一批的图（工坊别处或剧作家出的图也会广播）就不认领，也别顺手刷新父面板
      if (!jobsRef.current.some((job) => job.target === msg.target && job.status === "waiting")) return;
      setJobs((prev) =>
        prev.map((job) =>
          job.target === msg.target && job.status === "waiting"
            ? msg.ok && msg.url && msg.path
              ? { ...job, status: "done", url: msg.url, path: msg.path }
              : { ...job, status: "failed", message: msg.message ?? "生图失败" }
            : job,
        ),
      );
      if (msg.ok) onDone?.();
    });
    return unsubscribe;
  }, [subscribeImageResult, waitingTarget, hasPending, onDone]);

  const title =
    target.kind === "sprite"
      ? batch
        ? `批量生成立绘：${spriteId || "新主体"}`
        : target.fixedVariant
          ? `重生成立绘：${spriteId} / ${name}`
          : `生成立绘：${spriteId || "新主体"}`
      : target.kind === "background"
        ? "生成背景"
        : "生成 CG";

  const hint =
    target.kind === "sprite"
      ? batch
        ? "挑几个差分名（或自己敲），一次把这一批出完；每张分别出图，谁先好谁先亮。"
        : "填立绘 id 与差分名。同名角色卡有人设时一并喂给模型，没有卡只按你的描述出。"
      : "输入素材名称与描述，可选参考立绘垫图。";

  /** 输入框只收合法字符，非法字符当场吃掉（本体仍按 STEM 校一遍，给出解释而不是静默） */
  const cleanStem = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_]/g, "");

  /**
   * 谁能垫参考图：背景/CG 随时可以，立绘只有 `neutral` 定妆照可以——
   * 那是这个主体的**身份基准**，从别的图起手是它的正当用法；差分吃的是自己主体的
   * neutral，换基准会与既有差分不是同一个人，所以服务端直接拒。
   */
  const canPickRefs = target.kind !== "sprite" || name.trim() === NEUTRAL;

  const choices = useMemo(() => spriteVariantChoices(spriteDir?.variants ?? []), [spriteDir]);

  const toggleVariant = (variant: string): void => {
    if (hasPending) return;
    setError(null);
    setPicked((prev) => (prev.includes(variant) ? prev.filter((v) => v !== variant) : [...prev, variant]));
  };

  const removeVariant = (variant: string): void => {
    if (hasPending) return;
    setPicked((prev) => prev.filter((v) => v !== variant));
  };

  const addDraft = (): void => {
    const value = cleanStem(draft.trim());
    setDraft("");
    if (!value) return;
    if (!STEM.test(value)) {
      setError("差分名只允许小写字母开头的 a-z、数字、下划线，最长 40 字符");
      return;
    }
    // 已经在清单里就什么都不做：这里是在「加入」，反手把它取消掉只会让人以为敲丢了
    if (picked.includes(value)) return;
    setError(null);
    setPicked((prev) => [...prev, value]);
  };

  /**
   * 差分恒以该主体的 neutral 定妆照为身份基准，界面得把这件事说出来——用户看不见基准，
   * 就不知道自己在拿哪张图当同一个人的脸。缺失时按服务端的两条分支分别交代。
   */
  const baseline = ((): { text: string; url?: string } | null => {
    // 目录现状由调用方给（新主体还没有目录，那时不说不确定的句）
    if (target.kind !== "sprite" || !spriteDir) return null;
    const relevant = batch ? true : Boolean(name.trim()) && name.trim() !== NEUTRAL;
    if (!relevant) return null;
    if (spriteDir.neutralUrl) {
      return { text: "身份基准：neutral.png（差分都拿这张定妆照垫图，出来的才是同一个人）", url: spriteDir.neutralUrl };
    }
    if (spriteDir.variants.length === 0) {
      return { text: "这个主体还没有定妆照：会先自动出一张 neutral，再出这张差分。" };
    }
    return {
      text: `缺 neutral 定妆照（已有 ${spriteDir.variants.join("、")}）：请先单独出一次 neutral 再出差分，否则会与已有差分不是同一个人。`,
    };
  })();

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

  /**
   * 批量：这几张各发一次单张请求，**整批一起发出去**——一次一张地等受理会把每张的
   * 提示词组装串起来白等。并行度不在这里管：服务端的出图闸门（`image.concurrency`，
   * 默认 6）统一压着上游并发，这里多开几个 fetch 只是把活交上去。
   *
   * 失败重试走的是同一个口（只把失败的那几个再发一遍）。
   */
  const fireBatch = async (variants: string[]) => {
    if (target.kind !== "sprite") return;
    const id = spriteId.trim();
    if (!id) {
      setError("请填写立绘 id（目录名）");
      return;
    }
    if (!STEM.test(id)) {
      setError("立绘 id 只允许小写字母开头的 a-z、数字、下划线，最长 40 字符");
      return;
    }
    setError(null);
    const patch = (variant: string, next: Partial<BatchJob>): void =>
      setJobs((prev) => prev.map((job) => (job.variant === variant ? { ...job, ...next } : job)));
    setJobs((prev) => {
      const next = [...prev];
      for (const variant of variants) {
        const fresh: BatchJob = { variant, target: null, status: "submitting" };
        const idx = next.findIndex((job) => job.variant === variant);
        if (idx === -1) next.push(fresh);
        else next[idx] = fresh;
      }
      return next;
    });

    await Promise.all(
      variants.map(async (variant) => {
        try {
          const res = await api.generateImage(playId, {
            kind: "sprite",
            spriteId: id,
            variant,
            framing,
            stature,
            title: target.spriteTitle,
            instruction: instruction.trim() || undefined,
          });
          patch(variant, { target: res.target, status: "waiting" });
        } catch (e) {
          // 受理就失败（校验不过、生图没启用）的当场记账，别让它拖住其余几张
          patch(variant, { status: "failed", message: e instanceof Error ? e.message : String(e) });
        }
      }),
    );
  };

  const submitBatch = (): void => {
    if (picked.length === 0) {
      setError("先挑至少一个差分名");
      return;
    }
    void fireBatch([...picked]);
  };

  const primary = ((): { label: string; onClick: () => void; disabled: boolean } => {
    if (batch) {
      if (hasPending) {
        return { label: `生成中（${jobs.length - pending}/${jobs.length}）…`, onClick: () => {}, disabled: true };
      }
      // 有失败的就先给重试的口子：失败大多是上游抽风，重发一次往往就过了
      if (failedVariants.length > 0) {
        return {
          label: `重试失败的 ${failedVariants.length} 张`,
          onClick: () => void fireBatch(failedVariants),
          disabled: false,
        };
      }
      if (started) return { label: "完成", onClick: onClose, disabled: false };
      return {
        label: picked.length > 0 ? `发起生成（${picked.length} 张）` : "发起生成",
        onClick: submitBatch,
        disabled: picked.length === 0,
      };
    }
    return {
      label: result ? "完成" : submitting ? "生成中（预计 1~2 分钟）…" : "发起生成",
      onClick: () => void submit(),
      disabled: !canSubmit(),
    };
  })();

  return (
    <Modal
      title={title}
      hint={hint}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="primary" onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={onClose}
            disabled={!batch && submitting && !result}
          >
            {result ? "关闭" : batch && started ? "关闭" : "取消"}
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
                  disabled={target.spriteId !== "" || started}
                  onChange={(e) => {
                    setSpriteId(cleanStem(e.target.value));
                    setError(null);
                  }}
                />
              </div>
              {batch ? (
                <>
                  <div className="image-gen-field">
                    <span className="image-gen-label">差分（多选；标「已有」的是覆盖重出）：</span>
                    <div className="variant-chips">
                      {choices.map((choice) => {
                        const on = picked.includes(choice.name);
                        return (
                          <button
                            key={choice.name}
                            type="button"
                            className={`chip-btn${on ? " chip-btn-on" : ""}`}
                            disabled={hasPending}
                            onClick={() => toggleVariant(choice.name)}
                          >
                            {choice.name}
                            {choice.existing ? " ·已有" : ""}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      value={draft}
                      placeholder="再敲一个自定义差分名（回车加入）…"
                      disabled={hasPending}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addDraft();
                        }
                      }}
                    />
                    {picked.length > 0 ? (
                      <>
                        <span className="image-gen-label">待生成 {picked.length} 张（点一下去掉）：</span>
                        <div className="variant-chips">
                          {picked.map((variant) => (
                            <button
                              key={variant}
                              type="button"
                              className="chip-btn chip-btn-on"
                              disabled={hasPending}
                              title="从待生成里去掉"
                              onClick={() => removeVariant(variant)}
                            >
                              {variant} ×
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <span className="muted small">还没挑，点上面的差分名或自己敲一个</span>
                    )}
                  </div>
                </>
              ) : (
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
              )}
              {baseline && (
                <div className="image-gen-baseline">
                  {baseline.url && <img src={baseline.url} alt="neutral 定妆照" />}
                  <span className="muted small">{baseline.text}</span>
                </div>
              )}
              <div className="image-gen-field">
                <span className="image-gen-label">取景与体量：</span>
                <select
                  value={framing}
                  disabled={submitting || hasPending}
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
                  disabled={submitting || hasPending}
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
              disabled={submitting || hasPending}
              placeholder={
                target.kind === "sprite"
                  ? "描述想要的神态、手势或微表情，留空则由模型自由发挥…"
                  : "描述场景天气、光影、画面细节等…"
              }
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>

          {batch && jobs.length > 0 && (
            <div className="image-gen-jobs">
              {jobs.map((job) => (
                <div key={job.variant} className="image-gen-job">
                  <span className="muted small">{job.variant}</span>
                  {job.status === "submitting" && <span className="muted small">受理中…</span>}
                  {job.status === "waiting" && <span className="muted small">生成中…</span>}
                  {job.status === "failed" && <span className="error-text small">{job.message}</span>}
                  {job.status === "done" && job.url && <img src={job.url} alt={job.variant} />}
                </div>
              ))}
            </div>
          )}

          {submitting && !batch && (
            <div className="muted small" style={{ textAlign: "center", padding: "8px 0" }}>
              AI 正在绘制并抠底处理中，请稍候（不会阻塞其他操作）…
            </div>
          )}
          {hasPending && (
            <div className="muted small" style={{ textAlign: "center", padding: "8px 0" }}>
              这一批还在画（每张约 1~2 分钟，并行数由设置页的出图并发决定）…
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
