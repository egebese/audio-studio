"use client";

import * as React from "react";
import { JobsBell } from "@/components/jobs-bell";
import { ShowcaseCard } from "@/components/showcase-card";
import type { ProjectRef } from "@/lib/db";
import type { RunUiState } from "@/lib/studio-types";
import type { Job } from "@/lib/types";

export function StudioTopbar({
  projectName,
  projectId,
  projects,
  editingName,
  status,
  saving,
  runState,
  jobs,
  onRenameProject,
  onEditNameChange,
  onSwitchProject,
  onCreateProject
}: {
  projectName: string;
  projectId: string;
  projects: ProjectRef[];
  editingName: boolean;
  status: string;
  saving: boolean;
  runState: RunUiState;
  jobs: Job[];
  onRenameProject: (name: string) => void;
  onEditNameChange: (editing: boolean) => void;
  onSwitchProject: (id: string) => void;
  onCreateProject: () => void;
}) {
  const userProjects = projects.filter((project) => !project.id.startsWith("preview_"));
  const showcaseProjects = projects.filter((project) => project.id.startsWith("preview_"));
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">AUDIO</span>
        <small>CREATOR STUDIO V1</small>
      </div>
      {editingName ? (
        <input
          className="project-name-input"
          aria-label="Project name"
          autoFocus
          value={projectName}
          onChange={(event) => onRenameProject(event.target.value)}
          onBlur={() => onEditNameChange(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.stopPropagation();
              onEditNameChange(false);
            }
          }}
        />
      ) : (
        <button className="project-name" type="button" title="Click to rename project" onClick={() => onEditNameChange(true)}>
          {projectName}
        </button>
      )}
      {projects.length > 1 ? (
        <select
          className="select project-select"
          aria-label="Switch project"
          title="Switch project"
          value={projectId}
          onChange={(event) => onSwitchProject(event.target.value)}
        >
          {userProjects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
          {showcaseProjects.length ? (
            <optgroup label="Showcase">
              {showcaseProjects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
      ) : null}
      <button className="button compact" type="button" title="New project" aria-label="New project" onClick={onCreateProject}>
        + Project
      </button>
      <span className={`status ${status.includes("ERROR") ? "err" : status.includes("DONE") ? "ok" : ""}`}>
        {saving ? "[SAVING]" : status}
      </span>
      <ShowcaseCard projectId={projectId} />
      <JobsBell
        jobs={jobs}
        running={runState.status === "submitting"}
        runLabel={runState.label}
        progress={runState.progress}
      />
    </header>
  );
}
