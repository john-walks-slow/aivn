import { useCallback, useState } from "react";
import type { GeneratedAsset } from "@stage-ai/core";

/** 站内生成资产（bg/cg）：id 与 `<cg id>` / `<scene bg>` 同一命名空间。 */
export interface GeneratedImage {
  url: string;
  type: "bg" | "cg";
  /** 已预解码（可立即淡入，不必等 img 加载）。 */
  ready: boolean;
}

/**
 * 生图资产台账（D6 客户端侧）：收到就预解码，ready 后舞台才淡入——
 * 未解码完宁可停在骨架，也不给半张图（文字照常先行，骨架只是背景层）。
 */
export function useGeneratedAssets(): {
  images: Record<string, GeneratedImage>;
  add: (assets: GeneratedAsset[]) => void;
} {
  const [images, setImages] = useState<Record<string, GeneratedImage>>({});

  const add = useCallback((assets: GeneratedAsset[]): void => {
    if (assets.length === 0) return;
    setImages((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const asset of assets) {
        if (!asset.url || prev[asset.id]?.url === asset.url) continue;
        next[asset.id] = { url: asset.url, type: asset.type, ready: false };
        changed = true;
      }
      return changed ? next : prev;
    });
    // 解码预热放在 updater 之外：updater 必须是纯函数（StrictMode 会重复调用）
    for (const asset of assets) {
      // 解码失败也照挂：<img> 自己的加载器是最后一道判官（能画就画、画不出就是降级），
      // 卡在 ready=false 只会让舞台永远停在骨架
      void decode(asset.url).then((ok) => {
        if (!ok) console.warn(`[stage-ai] 生图预解码失败: ${asset.url}`);
        setImages((cur) => {
          const hit = cur[asset.id];
          if (!hit || hit.url !== asset.url || hit.ready) return cur;
          return { ...cur, [asset.id]: { ...hit, ready: true } };
        });
      });
    }
  }, []);

  return { images, add };
}

async function decode(url: string): Promise<boolean> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return true;
  } catch {
    return img.complete && img.naturalWidth > 0;
  }
}
