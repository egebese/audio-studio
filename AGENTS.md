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

- Keep the Nothing/OLED direction: black background, flat borders, red accent, no shadows/gradients/toasts.
- Use a Premiere-like layout: left Project media panel, center timeline, right Inspector/Generate/Jobs panel, bottom transport.
- Assets belong in the left Project panel. Generation controls belong in the right Generate tab.
- Track controls should stay compact. Avoid large button blocks in the track header.
- Right-click/context actions are expected for clips, assets, and tracks.
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

## Commands

```bash
npm run typecheck
npm run test
npm run build
npm run dev -- --port 3001
```

- Model jobs are live-only. If `FAL_KEY` is absent, `/api/jobs` must fail with a clear configuration error.
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
