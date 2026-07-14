"use client";

import * as React from "react";

const zoomLevels = [9, 18, 36, 72];
// Track-label gutter (px) that the lane content is offset by; used to keep the zoom cursor-anchored.
const laneGutter = 176;

// Owns timeline zoom: pixels-per-second, the scroll refs, ctrl/cmd-wheel zoom (non-passive so it
// can preventDefault), and cursor-anchored scroll restoration after a zoom.
export function useTimelineZoom(totalDuration: number, timelineLoaded: boolean) {
  const [pxPerSecond, setPxPerSecond] = React.useState(18);
  const tracksRef = React.useRef<HTMLDivElement | null>(null);
  const rulerTicksRef = React.useRef<HTMLDivElement | null>(null);
  const zoomAnchorRef = React.useRef<{ seconds: number; cursorX: number } | null>(null);

  React.useEffect(() => {
    const node = tracksRef.current;
    if (!node) return;
    // React's onWheel is passive; zooming needs preventDefault, so attach manually.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      setPxPerSecond((current) => {
        const next = Math.max(4, Math.min(200, current * Math.exp(-event.deltaY * 0.01)));
        if (next !== current) {
          const seconds = (cursorX + node.scrollLeft - laneGutter) / current;
          zoomAnchorRef.current = { seconds, cursorX };
        }
        return next;
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [timelineLoaded]);

  React.useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const node = tracksRef.current;
    if (!anchor || !node) return;
    zoomAnchorRef.current = null;
    node.scrollLeft = Math.max(0, anchor.seconds * pxPerSecond + laneGutter - anchor.cursorX);
    if (rulerTicksRef.current) {
      rulerTicksRef.current.style.transform = `translateX(-${node.scrollLeft}px)`;
    }
  }, [pxPerSecond]);

  function zoomIn() {
    setPxPerSecond((current) => zoomLevels.find((level) => level > current) ?? zoomLevels[zoomLevels.length - 1]);
  }

  function zoomOut() {
    setPxPerSecond((current) => [...zoomLevels].reverse().find((level) => level < current) ?? zoomLevels[0]);
  }

  function zoomFit() {
    const width = tracksRef.current?.clientWidth ?? 0;
    const usable = width - laneGutter - 24;
    if (usable <= 0 || totalDuration <= 0) return;
    setPxPerSecond(Math.max(4, Math.min(200, usable / totalDuration)));
  }

  return { pxPerSecond, tracksRef, rulerTicksRef, zoomIn, zoomOut, zoomFit };
}
