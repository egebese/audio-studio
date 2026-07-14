# Compose Character Voices and Showcase Separation

## Goal

Add optional character voice references to Compose while keeping the current
zero-character cinematic flow unchanged. Remove showcase signature copy from the
generic cinematic path and keep it only in an explicitly showcase-owned generator.

## Scope

- Compose accepts zero to three character rows.
- Each row maps a user-defined character alias to an existing project voice.
- The Compose description supports `@Character Name` autocomplete.
- Mentioned characters become ordered Seed Audio references at generation time.
- Generic cinematic output never adds AI, "written, not recorded", or similar
  showcase copy unless the user's brief explicitly asks for it.
- Existing hard-coded showcase pieces may retain that copy in a showcase-only path.

Uploading a new reference from a character row, creating provider-side voice
libraries, and making cast definitions persistent project entities are out of scope.

## User Experience

The Compose panel gains a collapsed optional `Characters` section. A user can add up
to three rows. Each row contains:

- a required character name, unique case-insensitively within the cast;
- a required selection from the project's saved voices;
- a remove action.

The description field reuses the existing mention textarea. Its suggestions come
from character aliases, not saved-voice names. Selecting a suggestion inserts the
alias, for example `@Queen`, and selected aliases appear as compact chips.

The section is optional. With no rows, Compose behaves exactly as it does today.
When rows exist, every speaking role must use the supplied cast. If narration is
needed, the user adds a `Narrator` character and mentions it in the brief. This keeps
the Seed Audio reference count at its existing maximum of three and avoids collisions
between external cast references and the internally generated narrator anchor.

Generation is blocked with a focused error when a character row is incomplete, names
are duplicated, a referenced asset is unavailable, or a selected reference exceeds
the Seed 30-second limit.

## Data Flow

### Planning request

`GeneratePanel` sends the brief and ordered character names to Studio. The planner
request contains:

```json
{
  "brief": "A queen confronts the warlord. @Queen speaks first.",
  "characterNames": ["Queen", "Warlord"]
}
```

Voice asset URLs remain client-side and are never sent to the planning endpoint.

The planner prompt tells the LLM to:

- preserve exact known `@Character Name` aliases in generated Seed prompts;
- use only supplied characters for speech when a cast exists;
- omit the internal generated anchor in cast mode;
- avoid showcase signatures unless the brief explicitly requests one.

### Validated cinematic spec

The cinematic spec keeps symbolic character mentions in prompts. Validation receives
the allowed character names. It preserves known mentions, converts unknown mentions
to plain text, enforces the three-character limit, and ensures cast mode does not
request the internal anchor.

The zero-character validation branch preserves the current anchor and `@Audio1`
behavior.

### Generation

Before planning, Studio resolves each character row to its saved `Voice`, referenced
audio `Asset`, and URL. It performs the existing Seed reference-duration validation.
The resolved cast is retained until planning succeeds and passed to `runCinematic`.

For each Seed TTS or Seed Scene prompt in cast mode, the runner:

1. finds known aliases mentioned in that prompt;
2. preserves first-appearance order and deduplicates them;
3. rewrites them to local positional `@Audio1`, `@Audio2`, and `@Audio3` tags;
4. attaches only the corresponding ordered URLs as `audio_urls`.

A scene can therefore use one, two, or three supplied characters without attaching
unused references. Score, SFX, Whisper cropping, loudness measurement, ducking, and
timeline assembly remain unchanged.

When no cast is supplied, the runner continues to generate and use the existing
single narrator anchor.

## Module Boundaries

### Compose UI

- Export and reuse the existing mention textarea instead of creating a second
  autocomplete implementation.
- Keep character-row state in `GeneratePanel`; pass a small serializable cast
  selection to Studio.
- Resolve saved voices and assets in Studio, where project data and existing
  reference validation already live.

### Planner and spec

- Extend `/api/cinematic/plan` with character names only.
- Extend cinematic spec validation with an optional allowed-character context.
- Keep symbolic aliases until the runner has the matching client-side URLs.

### Runner

- Extend `RunCinematicOptions` with an optional ordered cast.
- Reuse mention matching and replacement helpers with the cast aliases as targets.
- Do not change assembly data structures for this version.

## Showcase Ownership

The current hard-coded six-piece cinematic generator is showcase content, not the
generic product pipeline. Its specs and signature lines move behind an explicitly
showcase-named entry point. The generic cinematic path is the Compose planner and
runner.

The separation must make these rules explicit:

- showcase specs may contain "written, not recorded", "not a single word", and
  equivalent reveal copy;
- generic planner prompts, examples, validation fixtures, and skills do not prescribe
  that copy;
- a generic closing line is optional and appears only when requested by the brief;
- script and skill names must not direct normal cinematic work through a
  showcase-only generator.

Existing curated showcase JSON can retain its presentation reveal. Regenerating
generic cinematic content must not silently reintroduce it.

## Error Handling

- Incomplete or duplicate character rows: inline Compose validation; no API call.
- Missing saved voice or reference asset: generation error naming the character.
- Reference over 30 seconds: existing Seed reference-limit message, naming the
  character.
- Unknown mention returned by the planner: strip only the `@` marker so the text
  remains readable and no wrong voice is attached.
- Planner or model failure: retain existing status and retry behavior.

## Testing

### Helper tests

- Match aliases containing spaces and overlapping names.
- Preserve first-appearance order, deduplicate, and cap at three.
- Rewrite one-, two-, and three-character prompts to matching `@AudioN` tags and
  ordered URLs.
- Leave unknown aliases as plain text.

### Spec and runner tests

- Zero-character specs keep the current generated-anchor behavior.
- Cast mode suppresses the internal anchor.
- A multi-character Seed Scene receives the correct prompt and `audio_urls`.
- A prompt using only one cast member receives only that reference.
- The 30-second validation fails before jobs start.

### Product regressions

- Generic planner instructions and fixtures contain no automatic showcase signature.
- Generic closing lines remain optional.
- Showcase-only specs retain their signature copy.
- Existing cinematic assembly and loudness-ducking tests continue to pass.

## Acceptance Criteria

- A user can add up to three aliased saved voices in Compose and mention them in the
  description.
- Generated Seed jobs receive the correct character references in positional order.
- Compose without characters behaves as before.
- No generic cinematic generation automatically says that audio was written, not
  recorded, or that no words were spoken.
- Showcase-only generation remains able to produce its curated reveal.
