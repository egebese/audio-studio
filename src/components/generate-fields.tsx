"use client";

import * as React from "react";
import {
  findMentionedTargets,
  insertMention,
  mentionQueryAtCaret,
  type MentionQuery,
  type MentionTarget
} from "@/lib/mentions";
import { seedAudioEndpoint, type ModelDefinition } from "@/lib/model-catalog";
import { visibleSchemaFields, type ModelSchemaField } from "@/lib/model-schemas";
import type { Voice } from "@/lib/types";

export function InfoTip({ text }: { text: string }) {
  const [bubble, setBubble] = React.useState<{ x: number; y: number; below: boolean } | null>(null);
  const tooltipId = React.useId();

  function showBubble(node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    const below = rect.top < 96;
    setBubble({
      x: Math.min(rect.left, window.innerWidth - 264),
      y: below ? rect.bottom + 7 : rect.top - 7,
      below
    });
  }

  return (
    <span
      className="tip"
      aria-label="More information"
      aria-describedby={tooltipId}
      tabIndex={0}
      onMouseEnter={(event) => showBubble(event.currentTarget)}
      onMouseLeave={(event) => {
        if (document.activeElement !== event.currentTarget) setBubble(null);
      }}
      onFocus={(event) => showBubble(event.currentTarget)}
      onBlur={() => setBubble(null)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        setBubble(null);
      }}
    >
      ?
      {bubble ? (
        <span
          className={`tip-bubble ${bubble.below ? "" : "above"}`}
          id={tooltipId}
          style={{ left: bubble.x, top: bubble.y }}
          role="tooltip"
        >
          {text}
        </span>
      ) : (
        <span id={tooltipId} hidden>
          {text}
        </span>
      )}
    </span>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      className={`switch ${checked ? "on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function MentionTextarea({
  value,
  onChange,
  targets,
  maxLength,
  className = "textarea",
  placeholder,
  disabled,
  "aria-label": ariaLabel
}: {
  value: string;
  onChange: (next: string) => void;
  targets: MentionTarget[];
  maxLength?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [query, setQuery] = React.useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = React.useId();

  const needle = query?.text.toLowerCase();
  const matches = needle === undefined
    ? []
    : targets.filter((target) => target.name.toLowerCase().includes(needle)).slice(0, 6);

  function refreshQuery(node: HTMLTextAreaElement) {
    setQuery(targets.length ? mentionQueryAtCaret(node.value, node.selectionStart ?? node.value.length) : null);
    setActiveIndex(0);
  }

  function pick(target: MentionTarget) {
    if (!query) return;
    const result = insertMention(value, query, target.name);
    onChange(result.text);
    setQuery(null);
    window.requestAnimationFrame(() => {
      const node = areaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(result.caret, result.caret);
    });
  }

  return (
    <span className="mention-shell">
      <textarea
        ref={areaRef}
        className={className}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={matches.length ? listboxId : undefined}
        aria-expanded={matches.length > 0}
        aria-activedescendant={matches.length ? `${listboxId}-option-${activeIndex}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          refreshQuery(event.target);
        }}
        onClick={(event) => refreshQuery(event.currentTarget)}
        onKeyDown={(event) => {
          if (!matches.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            pick(matches[activeIndex]);
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setQuery(null);
          }
        }}
        onBlur={() => window.setTimeout(() => setQuery(null), 120)}
      />
      {matches.length ? (
        <span
          className="mention-popup"
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ? `${ariaLabel} mentions` : "Mention suggestions"}
        >
          {matches.map((target, index) => (
            <button
              className={index === activeIndex ? "active" : ""}
              id={`${listboxId}-option-${index}`}
              key={target.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(target);
              }}
            >
              <span className="mention-at">@</span>
              {target.name}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function FieldEditor({
  model,
  values,
  setValue,
  voices,
  uploadFieldFile
}: {
  model: ModelDefinition;
  values: Record<string, string | number | boolean>;
  setValue: (name: string, value: string | number | boolean) => void;
  voices: Voice[];
  uploadFieldFile: (field: ModelSchemaField, file: File) => Promise<void>;
}) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [uploadingField, setUploadingField] = React.useState("");
  const fields = visibleSchemaFields(model.id);
  const basicFields = fields.filter((field) => !field.advanced);
  const advancedFields = fields.filter((field) => field.advanced);

  async function handleFile(field: ModelSchemaField, file: File | undefined) {
    if (!file) return;
    setUploadingField(field.name);
    try {
      await uploadFieldFile(field, file);
    } finally {
      setUploadingField("");
    }
  }

  function renderControl(field: ModelSchemaField) {
    const value = values[field.name] ?? "";
    if (field.type === "textarea") {
      const isPrompt = field.name === "prompt" || field.name === "text";
      const mentioned =
        isPrompt && model.endpoint === seedAudioEndpoint ? findMentionedTargets(String(value), voices) : [];
      return (
        <>
          {isPrompt ? (
            <MentionTextarea
              value={String(value)}
              onChange={(next) => setValue(field.name, next)}
              targets={model.endpoint === seedAudioEndpoint ? voices : []}
              maxLength={field.maxLength}
            />
          ) : (
            <textarea
              className="textarea"
              value={String(value)}
              maxLength={field.maxLength}
              onChange={(event) => setValue(field.name, event.target.value)}
            />
          )}
          {mentioned.length ? (
            <span className="mention-chips">
              {mentioned.map((voice, index) => (
                <span className="mention-chip" key={voice.id} title={`Sent as reference @Audio${index + 1}`}>
                  @{voice.name}
                  <small>#{index + 1}</small>
                </span>
              ))}
            </span>
          ) : null}
        </>
      );
    }
    if (field.type === "enum") {
      return (
        <select className="select row-control" value={String(value)} onChange={(event) => setValue(field.name, event.target.value)}>
          <option value="">Select</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    if (field.type === "boolean") {
      return <Switch checked={Boolean(value)} onChange={(next) => setValue(field.name, next)} />;
    }
    if (field.type === "json" || field.type === "array") {
      return (
        <textarea
          className="textarea"
          value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          onChange={(event) => setValue(field.name, event.target.value)}
        />
      );
    }
    if (field.type === "number" || field.type === "integer") {
      const numberInput = (
        <input
          className="input number-input"
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === "integer" ? 1 : undefined)}
          value={String(value)}
          onChange={(event) => setValue(field.name, event.target.value === "" ? "" : Number(event.target.value))}
        />
      );
      if (field.min === undefined || field.max === undefined) return numberInput;
      return (
        <span className="range-row row-control">
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step ?? (field.type === "integer" ? 1 : undefined)}
            value={Number(value === "" ? field.defaultValue ?? field.min : value)}
            onChange={(event) => setValue(field.name, Number(event.target.value))}
          />
          {numberInput}
        </span>
      );
    }
    if (field.type === "url") {
      return (
        <span
          className="upload-field"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleFile(field, event.dataTransfer.files?.[0]);
          }}
        >
          <input
            className="input"
            type="url"
            placeholder="https:// or drop a file"
            value={String(value)}
            onChange={(event) => setValue(field.name, event.target.value)}
          />
          <label className="button compact upload-button">
            {uploadingField === field.name ? "..." : "Upload"}
            <input
              type="file"
              hidden
              accept={field.name.includes("image") ? "image/*" : "audio/*"}
              onChange={(event) => {
                void handleFile(field, event.target.files?.[0] ?? undefined);
                event.target.value = "";
              }}
            />
          </label>
        </span>
      );
    }
    // The voice-name field suggests saved voices so a consistent name is reused across runs.
    const voiceList = field.name === "voice" && voices.length ? `voices-${field.name}` : undefined;
    return (
      <>
        <input
          className="input"
          type="text"
          list={voiceList}
          value={String(value)}
          onChange={(event) => setValue(field.name, event.target.value)}
        />
        {voiceList ? (
          <datalist id={voiceList}>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.name} />
            ))}
          </datalist>
        ) : null}
      </>
    );
  }

  function renderField(field: ModelSchemaField) {
    const compactRow = field.type === "boolean" || field.type === "enum" || field.type === "number" || field.type === "integer";
    const value = values[field.name] ?? "";
    return (
      <div className={`field ${compactRow ? "field-row" : ""}`} key={field.name}>
        <span className="field-label">
          <span className="label">
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
            {field.required ? " *" : ""}
          </span>
          {field.helper ? <InfoTip text={field.helper} /> : null}
          {field.type === "textarea" && field.maxLength ? (
            <span className="char-count">
              {String(value).length}/{field.maxLength}
            </span>
          ) : null}
        </span>
        {renderControl(field)}
      </div>
    );
  }

  return (
    <>
      {basicFields.map(renderField)}
      {advancedFields.length ? (
        <div className="advanced-group">
          <button
            className="advanced-toggle"
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((open) => !open)}
          >
            Advanced <span>{advancedFields.length}</span>
            <span className="advanced-chevron">{showAdvanced ? "▴" : "▾"}</span>
          </button>
          {showAdvanced ? advancedFields.map(renderField) : null}
        </div>
      ) : null}
    </>
  );
}
