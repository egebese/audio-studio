# AGENTS.md

Project guidance for agents working in this repository.

## Product

- This is an audio-only creator studio. Do not add video ingest or video editing unless the user explicitly changes scope.
- The first screen is the studio, not a landing page.
- Core workflows: upload/generate audio, drag assets to timeline, trim/move clips, select regions, save region/clip as asset or voice reference, transcribe speech regions, and run transform models.
- Voice references are local V1 references backed by audio assets. Do not add provider-side persistent voice libraries unless requested.

## Architecture

- Next.js app router lives in `src/app`.
- Main UI is `src/components/studio.tsx`.
- Local-first project graph is stored through `src/lib/db.ts` in IndexedDB.
- Server job wrapper is `src/server/jobs.ts` and API routes under `src/app/api/jobs`.
- Model definitions live in `src/lib/model-catalog.ts`; add model behavior there before branching UI logic.
- Result normalization lives in `src/lib/result.ts`; transcript-specific normalization lives in `src/lib/transcript.ts`.
- Timeline math belongs in focused helpers:
  - `src/lib/clip-edit.ts`
  - `src/lib/region.ts`
  - `src/lib/track-ops.ts`
  - `src/lib/audio-export.ts`
- Keep transforms immutable: generated/derived outputs create new `Asset`s and preserve lineage. Do not mutate source assets except for metadata such as transcript attachment.

## UI Rules

- Keep the Nothing/OLED direction: black background, flat borders, red accent, no gradients.
- Elevation policy: higher surfaces are lighter (`--surface` panels → `--surface-raised` cards/hover → `--surface-overlay` menus/popovers). Floating elements (popovers, menus, toasts) use `--border-strong` + `box-shadow: var(--shadow-overlay)`; nothing else gets shadows.
- Layout: left Generate panel (persistent), center timeline, right rail with Project media (top) + Inspector (bottom), bottom transport. Jobs live in the topbar bell popover (`src/components/jobs-bell.tsx`), not a panel.
- Tailwind v4 is imported WITHOUT preflight and themed via the shadcn bridge in `globals.css`. Existing rules are unlayered and always beat utilities — do not mix Tailwind utilities onto elements that already carry legacy classes. shadcn/ElevenLabs components live in `src/components/ui/`.
- Track controls should stay compact. Avoid large button blocks in the track header.
- Right-click/context actions are expected for clips, assets, and tracks.
- Desktop-app density: `body { font-size: 13px }`, 28px inputs/buttons, 42px topbar / 50px transport. Never reintroduce 44px touch targets — this is a desktop tool, not a mobile-accessible site.
- Generate fields are schema-driven (`model-schemas.ts`): booleans render as `Switch`, numbers with `min`+`max` render as slider+number, `helper` renders as a hover `InfoTip` (fixed-position bubble, never inline text). Descriptions/helper prose belong in tooltips everywhere, not inline `.fine` paragraphs.
- File inputs go through `/api/upload` (fal.storage) with a data-URL fallback; OS files can be dropped anywhere (global overlay) and `url`-type schema fields double as drop zones. Keep asset URLs remote so IndexedDB snapshots stay small.
- Saved voices are referenced in prompts via `@Name` mentions (`src/lib/mentions.ts`): autocomplete in the prompt textarea, chips under it, resolved to `@AudioN` + `audio_urls` at enhance/run time. Seed-endpoint models only.
- Maintain accessibility basics: `aria-label` for icon/short controls, keyboard focus, disabled state.

## Audio Rules

- Solo precedence applies to playback and export: if any track is soloed, only solo tracks are audible/exported; otherwise muted tracks are excluded.
- Track gain is the single source of truth for preview and export level.
- Region selection maps timeline seconds to source seconds through `regionToSourceSeconds`.
- Transcript segment times are asset-local seconds. Convert to timeline regions with `assetSegmentToTimelineRegion`.
- Whisper ASR edit flow should use:
  - `task: "transcribe"`
  - `diarize: true`
  - `chunk_level: "segment"`
- Do not allow Whisper on generated music or generated SFX assets. Uploaded assets remain allowed.
- Speaker label clicks in the transcript should play only that speaker's visible blocks; transcript text/time clicks should select the segment region.
- Output placement via `planTransformPlacement` (`output-placement.ts`), three modes: inpaint→"replace-region" (the SOURCE CLIP is split at the gap and the repair sits between the halves on the same track — clip surgery only, the source asset stays untouched), extend→"same-track-after" (butt-joined right after the source clip, never overlapping), dub/restyle/voice-change/stable-a2a→"lane-below" (aligned take lane directly below the source track; the lane is born MUTED because takes are alternatives — stacking them over the source is cacophony). Fresh cut edges (split, cut-to-gap) get a 0.02s seam fade against clicks. Generate outputs drop at the playhead on the model's default lane, not the project end.
- Clips can be split at the playhead (`splitClipAt` in `clip-edit.ts`; "S" key or clip context menu).
- Generated outputs are auto-trimmed for edge silence at clip level (`silence.ts` + `audibleWindow`): the clip lands on the audible window, the asset keeps full audio, a `[TRIMMED]` toast reports the cut. Inpaint and dub are exempt (raw timing contracts). Fully silent outputs skip the clip and warn.
- Clip fades: `fadeIn`/`fadeOut`/`gain` are honored in export (gain automation in `renderTimelineToWav`) and live playback (rAF envelope in `playTimeline`), and editable in the Inspector clip card. Seam crossfades are written at placement time.
- Seed 30s reference cap: window long sources with `trailingWindow` (extend does this automatically) rather than rejecting.
- Cast = selected voice + `@`-mentions merged into one ordered `audio_urls`/`@AudioN` list in `model-input.ts` (Voice Changer stays single-target via `target_voice_url`).
- Captions export via `captions.ts` (`toSrt`/`toVtt`); "Takes" (`variations`, clientOnly) re-fires the job N times and stacks outputs; "Split by speaker" builds per-speaker lanes from diarization.
- Dub is EN/ZH only (Seed limit); `fit_to_length` feeds `source_duration_s` into the prompt. Inpaint `verbatim` speaks exact words (bypasses `sanitizeDirective`); descriptive fill is the default.

## Commands

```bash
npm run typecheck
npm run test
npm run build
npm run dev -- --port 3001
```

- Model jobs are live-only. If `FAL_KEY` is absent, `/api/jobs` must fail with a clear configuration error.
- Live tool smoke test: `node scripts/run-tool-previews.mjs` (dev server + `FAL_KEY` required) runs every model through `/api/jobs` and writes `public/tool-previews.json`; the topbar "Previews" button imports one project per tool for inspection.
- Persona showcase demos: `node scripts/make-showcase.mjs` builds a marketing hero ("LIFTOFF", ~36s rocket-launch scene from prompts) plus 4 mixed multi-tool demos (ad, cinematic, story, documentary) via live `/api/jobs`, assembled with the same placement geometry as `output-placement.ts`. Scenes are whisper-cropped to spoken content (`speechCrop`) to hit a target length. Run a single one with `--only=hero` (etc.). Each inpaint is made legible: the source clip is split with a verbatim repair between the halves, and a muted "Ham (önce)" lane holds the full original for A/B. The topbar "Showcase" button (`importShowcase` in `studio.tsx`) loads only the full-project drop-ins listed there and REPLACES the demo set each time (`importSnapshots` prunes stale `preview_*` via `deleteSnapshotsByPrefix`). Persona cards (`persona/goal/shows/steps`) live in `public/showcase.json`, keyed by `project.id`, surfaced by the topbar "◆ Showcase" popover (`showcase-card.tsx`) which auto-opens when a showcased project loads. The full 20-persona catalog + coverage matrix is `docs/showcase-personas.md`. Retired content (16 isolated tool previews + the first simple demos) lives in `public/_archive/`; the tool-preview builders (`tool-previews.ts`, `run-tool-previews.mjs`) are kept for that path.
- After cache-sensitive UI changes, it is acceptable to remove `.next` and restart dev server.

## Testing Expectations

- Add or update small Vitest tests for non-trivial logic.
- Prefer helper-level tests over browser-heavy tests for timeline math, transcript mapping, asset rules, lineage, and model/result normalization.
- Before calling work done, run at least `npm run typecheck` and `npm run test`; run `npm run build` for UI/API changes.

## Style

- Keep edits scoped. Reuse existing helpers before adding new abstractions.
- Avoid speculative scaffolding and one-off frameworks.
- Use `apply_patch` for manual file edits.
- Keep files ASCII unless existing content requires otherwise.
