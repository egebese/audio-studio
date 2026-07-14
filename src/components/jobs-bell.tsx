"use client";

import * as React from "react";
import type { Job } from "@/lib/types";

interface JobsBellProps {
  jobs: Job[];
  running: boolean;
  runLabel: string;
  progress?: number;
}

export function JobsBell({ jobs, running, runLabel, progress }: JobsBellProps) {
  const [open, setOpen] = React.useState<"hover" | "pinned" | null>(null);

  React.useEffect(() => {
    if (open !== "pinned") return;
    function onDocClick() {
      setOpen(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const history = [...jobs].reverse();

  return (
    <div
      className="jobs-bell"
      onMouseEnter={() => setOpen((current) => current ?? "hover")}
      onMouseLeave={() => setOpen((current) => (current === "hover" ? null : current))}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="jobs-bell-button"
        aria-label={running ? "Jobs: model running" : `Jobs: ${jobs.length} in history`}
        aria-expanded={open !== null}
        onClick={() => setOpen((current) => (current === "pinned" ? null : "pinned"))}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 10.5v1h10.8v-1L12 8.1V5.5a4 4 0 0 0-4-4Z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        {running ? <span className="jobs-bell-dot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="jobs-popover" role="dialog" aria-label="Jobs">
          <span className="label">Jobs</span>
          {running ? (
            <div className="job">
              <strong>{runLabel}</strong>
              <span className="progress-track" aria-hidden="true">
                <span className="progress-fill" style={{ width: `${Math.max(progress ?? 0, 5)}%` }} />
              </span>
            </div>
          ) : null}
          {history.length ? (
            <div className="job-list">
              {history.map((job) => (
                <div className="job" key={job.id}>
                  <strong>{job.modelId}</strong>
                  <p className="fine">{job.status.toUpperCase()} / {job.progress}% / {job.outputs.length} output(s)</p>
                  {job.error ? <p className="fine">[ERROR] {job.error}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          {!running && !history.length ? <p className="fine">No jobs yet. Run a model in Generate.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
