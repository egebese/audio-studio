"use client";

import * as React from "react";

// OS-file drag-and-drop anywhere in the window; internal asset drags use text/plain and skip this.
// Returns whether a file drag is currently hovering, for the global drop overlay.
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [fileDragActive, setFileDragActive] = React.useState(false);
  const depthRef = React.useRef(0);
  const onFilesRef = React.useRef(onFiles);
  onFilesRef.current = onFiles;

  React.useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depthRef.current += 1;
      setFileDragActive(true);
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (!depthRef.current) setFileDragActive(false);
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      depthRef.current = 0;
      setFileDragActive(false);
      // Capture phase: reset the overlay even when a field drop-zone stops propagation, but let it own the file.
      if ((event.target as HTMLElement | null)?.closest(".upload-field")) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) onFilesRef.current(files);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  return { fileDragActive };
}
