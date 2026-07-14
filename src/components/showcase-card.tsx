"use client";

import * as React from "react";
import { loadShowcaseMap, type ShowcaseMap } from "@/lib/showcase";

// Persona guide for demo projects. Renders nothing unless the active project id has
// a showcase.json entry. Auto-opens on entry so the "point" lands immediately; the
// user can dismiss, and the topbar chip re-opens it.
export function ShowcaseCard({ projectId }: { projectId: string }) {
  const [map, setMap] = React.useState<ShowcaseMap>({});
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    void loadShowcaseMap().then(setMap);
  }, []);

  const card = map[projectId];

  // Auto-open when entering a showcase project (or when the map first resolves).
  React.useEffect(() => {
    setOpen(Boolean(card));
  }, [projectId, card]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!card) return null;

  return (
    <div className="showcase" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="showcase-button"
        aria-expanded={open}
        title="Showcase — what this demo shows"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">◆</span> Showcase
      </button>
      {open ? (
        <div className="showcase-popover" role="dialog" aria-label="Showcase">
          <div className="showcase-head">
            <strong>{card.persona}</strong>
            <button type="button" className="showcase-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <p className="showcase-goal">{card.goal}</p>
          {card.shows.length ? (
            <div className="showcase-chips">
              {card.shows.map((item) => (
                <span className="showcase-chip" key={item}>{item}</span>
              ))}
            </div>
          ) : null}
          {card.steps.length ? (
            <ol className="showcase-steps">
              {card.steps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
