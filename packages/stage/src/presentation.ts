import { layoutSprites, type SpritePosition } from "@aivn/core";
import type { SpriteSlot } from "./director.js";
import type { SpritePresentation } from "./assets.js";

export type PresentationProfile = "desktop" | "portrait" | "narrow-portrait";

export interface PresentationActor {
  visible: boolean;
  renderPos: SpritePosition;
  renderScale: number;
  reason: "visible" | "speaker" | "keep-visible" | "newer-entry" | "suppressed-overflow";
}

export interface PresentationPlan {
  profile: PresentationProfile;
  capacity: number;
  actors: Record<string, PresentationActor>;
}

export interface PresentationInput {
  width: number;
  height: number;
  sprites: Record<string, SpriteSlot>;
  speakerId: string | null;
  presentations?: Readonly<Record<string, SpritePresentation>>;
}

export function presentationProfile(width: number, height: number): PresentationProfile {
  if (width <= 0 || height <= 0 || width >= height) return "desktop";
  return width < 480 ? "narrow-portrait" : "portrait";
}

function capacityOf(profile: PresentationProfile): number {
  return profile === "narrow-portrait" ? 2 : profile === "portrait" ? 3 : Number.POSITIVE_INFINITY;
}

/**
 * 设备只影响这一层的可见性，不改 VisualState。
 * 选择顺序固定为：说话人 > keepVisible > 新入场 > 旧入场 > id。
 */
export function presentationPlan(input: PresentationInput): PresentationPlan {
  const profile = presentationProfile(input.width, input.height);
  const capacity = capacityOf(profile);
  const ids = Object.keys(input.sprites).filter((id) => !input.sprites[id]!.leaving);
  const ranked = [...ids].sort((a, b) => {
    const sa = input.sprites[a]!;
    const sb = input.sprites[b]!;
    const speakerDelta = Number(b === input.speakerId) - Number(a === input.speakerId);
    if (speakerDelta) return speakerDelta;
    const keepDelta = Number(sb.keepVisible) - Number(sa.keepVisible);
    if (keepDelta) return keepDelta;
    return (sb.orderSeq - sa.orderSeq) || a.localeCompare(b);
  });
  const mandatory = ranked.filter((id) => id === input.speakerId || input.sprites[id]!.keepVisible);
  const retained = new Set([...mandatory, ...ranked.filter((id) => !mandatory.includes(id)).slice(0, Math.max(0, capacity - mandatory.length))]);
  const visibleIds = ids.filter((id) => retained.has(id)).sort((a, b) => {
    return (input.sprites[a]!.orderSeq - input.sprites[b]!.orderSeq) || a.localeCompare(b);
  });
  const explicit = new Map<string, SpritePosition>();
  for (const id of visibleIds) {
    const pos = input.sprites[id]!.pos;
    if (pos) explicit.set(id, pos);
  }
  const positions = layoutSprites(visibleIds, explicit);
  const actors: Record<string, PresentationActor> = {};
  for (const id of Object.keys(input.sprites)) {
    const slot = input.sprites[id]!;
    const visible = retained.has(id) || Boolean(slot.leaving);
    const reason = !visible
      ? "suppressed-overflow"
      : id === input.speakerId
        ? "speaker"
        : slot.keepVisible
          ? "keep-visible"
          : slot.orderSeq === Math.max(...visibleIds.map((visibleId) => input.sprites[visibleId]!.orderSeq), 0)
            ? "newer-entry"
            : "visible";
    actors[id] = {
      visible,
      renderPos: positions.get(id) ?? slot.resolvedPos,
      renderScale: 1,
      reason,
    };
  }
  return { profile, capacity, actors };
}
