import { useCallback, useState } from "react";
import type { GeneratedAsset } from "@aivn/core";

/**
 * 站内生成资产：id 与 `<cg id>` / `<scene bg>` 同一命名空间；立绘用 `<立绘>:<差分>`，
 * 只当作「有东西到货了」的信号（立绘图本身按目录从素材列表取，不查这张表）。
 */
export interface GeneratedImage {
  url: string;
  type: "bg" | "cg" | "sprite";
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
    // bgm 也走 asset_ready，但**不进这张表**：它要的是「素材页重拉」而不是「舞台淡入」，
    // 而预解码与骨架占位都是图的机制（音频没有骨架，也不该在等解码时停住）。
    // 少 preload 的那一下不影响音频——到货直接播。
    const images = assets.filter((a) => a.type !== "bgm");
    if (images.length === 0) return;
    setImages((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const asset of images) {
        if (!asset.url || prev[asset.id]?.url === asset.url) continue;
        next[asset.id] = { url: asset.url, type: asset.type as GeneratedImage["type"], ready: false };
        changed = true;
      }
      return changed ? next : prev;
    });
    // 解码预热放在 updater 之外：updater 必须是纯函数（StrictMode 会重复调用）
    for (const asset of images) {
      // 解码失败也照挂：<img> 自己的加载器是最后一道判官（能画就画、画不出就是降级），
      // 卡在 ready=false 只会让舞台永远停在骨架
      void decode(asset.url).then((ok) => {
        if (!ok) console.warn(`[aivn] 生图预解码失败: ${asset.url}`);
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
