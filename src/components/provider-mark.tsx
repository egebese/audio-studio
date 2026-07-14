"use client";

import * as React from "react";
import ProviderIcon from "@lobehub/icons/es/features/ProviderIcon";
import Fal from "@lobehub/icons/es/Fal";
import Stability from "@lobehub/icons/es/Stability";
import { lobeProviderIconKey, modelLettermark } from "@/lib/model-picker";
import type { ModelDefinition } from "@/lib/model-catalog";

// ProviderIcon's enum lacks these providers in @lobehub/icons 1.90; their standalone icons still ship.
const directProviderIcons: Record<string, React.ComponentType<{ size?: number | string }>> = {
  fal: Fal,
  stability: Stability
};

export function ProviderMark({ model, size = 18 }: { model: ModelDefinition; size?: number }) {
  const iconKey = lobeProviderIconKey(model);
  const DirectIcon = directProviderIcons[(model.providerIconKey ?? "").toLowerCase()];
  return (
    <span className="provider-mark" aria-hidden="true">
      {iconKey ? (
        <ProviderIcon provider={iconKey} size={size} type="mono" />
      ) : DirectIcon ? (
        <DirectIcon size={size} />
      ) : (
        <span>{modelLettermark(model)}</span>
      )}
    </span>
  );
}

export function ModelBadges({ model }: { model: ModelDefinition }) {
  const badges = [
    model.needsSource ? "Source" : undefined,
    model.needsRegion ? "Region" : undefined,
    model.needsVoice ? "Voice" : undefined,
    ...model.capabilities,
    model.durationHint
  ].filter((badge, index, all): badge is string => Boolean(badge) && all.indexOf(badge) === index);

  return (
    <span className="model-badges">
      {badges.slice(0, 6).map((badge) => (
        <span className="pill" key={badge}>{badge}</span>
      ))}
    </span>
  );
}
