"use client";

import * as React from "react";
import type { Toast } from "@/lib/studio-types";

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Play / pause timeline"],
  ["← / →", "Seek 0.5s back / forward"],
  ["Shift + ← / →", "Seek 5s back / forward"],
  ["Del", "Delete selected clip"],
  ["S", "Split selected clip at playhead"],
  ["+ / -", "Zoom timeline in / out"],
  ["⌘ / Ctrl + scroll", "Zoom timeline at cursor"],
  ["[ / ]", "Collapse left / right panel"],
  ["Esc", "Close menus and popovers"],
  ["?", "Toggle this help"]
];

export function StudioOverlays({
  fileDragActive,
  toast,
  shortcutsOpen,
  onCloseShortcuts
}: {
  fileDragActive: boolean;
  toast: Toast | null;
  shortcutsOpen: boolean;
  onCloseShortcuts: () => void;
}) {
  return (
    <>
      {fileDragActive ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <span className="drop-overlay-title">Drop files to import</span>
            <span className="fine">Audio → Project assets · Image → model input · uploads to fal storage</span>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      ) : null}
      {shortcutsOpen ? (
        <div className="shortcuts-overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={onCloseShortcuts}>
          <div className="shortcuts-panel" onClick={(event) => event.stopPropagation()}>
            <span className="label">Keyboard Shortcuts</span>
            {SHORTCUTS.map(([key, label]) => (
              <div className="shortcut-row" key={key}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
