"use client";

import * as React from "react";
import { loadPeaks } from "@/lib/waveform";
import type { Asset, Clip } from "@/lib/types";

export function ClipWave({ clip, asset }: { clip: Clip; asset?: Asset }) {
  const [peaks, setPeaks] = React.useState<number[] | null>(null);

  React.useEffect(() => {
    if (!asset?.url || !asset.duration) return;
    let alive = true;
    const buckets = Math.min(4000, Math.max(100, Math.round(asset.duration * 20)));
    void loadPeaks(asset.id, asset.url, buckets).then((result) => {
      if (alive) setPeaks(result);
    });
    return () => {
      alive = false;
    };
  }, [asset?.id, asset?.url, asset?.duration]);

  // Fallback to the CSS pattern while decoding, or when decode fails (e.g. CORS on remote files).
  if (!peaks?.length || !asset?.duration) return <span className="wave" aria-hidden="true" />;

  const total = peaks.length;
  const startIndex = Math.max(0, Math.floor((clip.offset / asset.duration) * total));
  const endIndex = Math.min(total, Math.ceil(((clip.offset + clip.duration) / asset.duration) * total));
  const window = peaks.slice(startIndex, Math.max(endIndex, startIndex + 1));
  const stride = Math.max(1, Math.ceil(window.length / 300));
  const bars: number[] = [];
  for (let index = 0; index < window.length; index += stride) {
    bars.push(Math.max(...window.slice(index, index + stride)));
  }

  return (
    <svg className="wave wave-svg" viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((peak, index) => {
        const height = Math.max(4, peak * 96);
        return <rect key={index} x={index + 0.15} y={(100 - height) / 2} width={0.7} height={height} />;
      })}
    </svg>
  );
}
