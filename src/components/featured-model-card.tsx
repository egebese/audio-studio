"use client";

import * as React from "react";
import { ModelBadges, ProviderMark } from "@/components/provider-mark";
import { useAudioPlayer } from "@/components/ui/audio-player";
import type { ModelDefinition } from "@/lib/model-catalog";

export function FeaturedModelCard({
  model: item,
  active,
  onSelect
}: {
  model: ModelDefinition;
  active: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [posterFailed, setPosterFailed] = React.useState(false);
  const media = item.media;

  if (!media || posterFailed) {
    return (
      <button className={`model-picker-row ${active ? "active" : ""}`} type="button" onClick={onSelect}>
        <ProviderMark model={item} />
        <span className="model-row-main">
          <strong>{item.label}</strong>
          <span>{item.description}</span>
        </span>
        <ModelBadges model={item} />
      </button>
    );
  }

  const playVideo =
    hovered && Boolean(media.video) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <button
      type="button"
      className={`featured-card ${active ? "active" : ""}`}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <span className="featured-media">
        <img src={media.poster} alt="" loading="lazy" draggable={false} onError={() => setPosterFailed(true)} />
        {playVideo ? <video src={media.video} autoPlay loop muted playsInline /> : null}
      </span>
      <span className="featured-info">
        <ProviderMark model={item} size={16} />
        <strong>{item.label}</strong>
        <span className="pill">{item.task}</span>
      </span>
      <span className="featured-desc">{item.description}</span>
    </button>
  );
}

export function PlayerBridge({ pauseRef }: { pauseRef: React.MutableRefObject<(() => void) | null> }) {
  const player = useAudioPlayer();
  const pause = player.pause;
  React.useEffect(() => {
    pauseRef.current = () => void pause();
  }, [pause, pauseRef]);
  return null;
}
