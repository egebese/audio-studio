# Compose Character Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional aliased saved voices to Compose and isolate showcase-only signature copy from the generic cinematic pipeline.

**Architecture:** Compose keeps zero to three character rows and sends only their aliases to the planner. Studio resolves the selected project voices locally, while the cinematic runner rewrites symbolic `@Character` mentions to per-job `@AudioN` tags and attaches only the referenced URLs. Cast mode disables the generated narrator anchor; the zero-cast path remains unchanged. The existing hard-coded cinematic script becomes explicitly showcase-only.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, fal Seed Audio, existing IndexedDB project graph.

**Design reference:** `docs/superpowers/specs/2026-07-14-compose-character-voices-design.md`

---

## File Map

- Create `src/lib/cinematic-cast.ts`: cast row validation, saved-voice resolution, and per-prompt reference mapping.
- Create `src/lib/cinematic-cast.test.ts`: pure helper coverage.
- Modify `src/lib/mentions.ts` and `src/lib/mentions.test.ts`: safely remove unresolved mention markers after known mentions are rewritten.
- Modify `src/lib/cinematic-spec.ts` and `src/lib/cinematic-spec.test.ts`: cast-aware validation that suppresses the internal anchor.
- Modify `src/lib/cinematic-runner.ts` and `src/lib/cinematic-runner.test.ts`: attach cast URLs to Seed jobs.
- Create `src/lib/cinematic-plan-prompt.ts` and `src/lib/cinematic-plan-prompt.test.ts`: testable generic/cast planner instructions.
- Modify `src/app/api/cinematic/plan/route.ts`: accept character names and use cast-aware planning.
- Modify `src/components/generate-fields.tsx`: export a generic mention textarea.
- Modify `src/components/generate-panel.tsx`: optional character rows and alias autocomplete.
- Modify `src/components/studio.tsx`: resolve selected voices and pass cast through plan/run.
- Modify `src/app/styles/generate.css`: compact character-row styling.
- Keep the hard-coded six-piece generator at
  `scripts/make-showcase-cinematics.mjs` as an explicitly showcase-owned entry point.
- Modify `.claude/skills/cinematic-audio/SKILL.md`, `.claude/skills/seed-scene-prompting/SKILL.md`, `.claude/skills/seed-voice-cloning/SKILL.md`, and `.claude/skills/audio-loudness-ducking/SKILL.md`: distinguish product Compose from showcase generation.

Commit steps are intentionally omitted because the user did not request git commits.

---

### Task 1: Cast and mention helpers

**Files:**
- Create: `src/lib/cinematic-cast.ts`
- Create: `src/lib/cinematic-cast.test.ts`
- Modify: `src/lib/mentions.ts`
- Modify: `src/lib/mentions.test.ts`

- [ ] **Step 1: Write failing mention sanitization tests**

Add tests proving known audio tags survive, unknown prompt mentions become readable
plain text, and email-like text is unchanged:

```ts
describe("stripUnknownMentionMarkers", () => {
  it("strips unresolved prompt mentions but preserves audio tags and email text", () => {
    expect(
      stripUnknownMentionMarkers(
        "mail me@example.com; @Audio1 answers @Ghost."
      )
    ).toBe("mail me@example.com; @Audio1 answers Ghost.");
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npx vitest run src/lib/mentions.test.ts
```

Expected: FAIL because `stripUnknownMentionMarkers` is not exported.

- [ ] **Step 3: Implement unresolved-marker sanitization**

Add to `src/lib/mentions.ts`:

```ts
export function stripUnknownMentionMarkers(text: string): string {
  return text.replace(
    /(^|[^\p{L}\p{N}_])@(?!Audio\d+\b)/gu,
    "$1"
  );
}
```

This deliberately leaves `me@example.com` unchanged because the `@` is preceded by a
letter, and leaves resolved `@AudioN` tags intact.

- [ ] **Step 4: Write failing cast resolution tests**

Cover:

```ts
const voices = [
  { id: "voice_queen", projectId: "p", name: "Warm Voice", refAssetId: "asset_q", createdAt: "now" },
  { id: "voice_warlord", projectId: "p", name: "Deep Voice", refAssetId: "asset_w", createdAt: "now" }
];
const assets = [
  { id: "asset_q", projectId: "p", kind: "audio", trackKind: "voice", name: "Q", url: "https://q.wav", duration: 8, source: "upload", createdAt: "now" },
  { id: "asset_w", projectId: "p", kind: "audio", trackKind: "voice", name: "W", url: "https://w.wav", duration: 9, source: "upload", createdAt: "now" }
];

expect(resolveComposeCast(
  [
    { id: "row_q", name: "Queen", voiceId: "voice_queen" },
    { id: "row_w", name: "Warlord", voiceId: "voice_warlord" }
  ],
  voices,
  assets
)).toEqual([
  { id: "row_q", name: "Queen", url: "https://q.wav", duration: 8 },
  { id: "row_w", name: "Warlord", url: "https://w.wav", duration: 9 }
]);
```

Also assert readable errors for duplicate aliases, incomplete rows, missing voice
assets, more than three rows, and references over 30 seconds.

- [ ] **Step 5: Implement cast types and resolution**

Create:

```ts
import type { Asset, Voice } from "@/lib/types";
import {
  findMentionedTargets,
  replaceMentionsWithAudioTags,
  stripUnknownMentionMarkers
} from "@/lib/mentions";

export const MAX_CINEMATIC_CAST = 3;
export const MAX_SEED_REFERENCE_SECONDS = 30;

export interface ComposeCharacter {
  id: string;
  name: string;
  voiceId: string;
}

export interface CinematicCastRef {
  id: string;
  name: string;
  url: string;
  duration: number;
}

export function resolveComposeCast(
  rows: ComposeCharacter[],
  voices: Voice[],
  assets: Asset[]
): CinematicCastRef[] {
  if (rows.length > MAX_CINEMATIC_CAST) {
    throw new Error(`Compose supports up to ${MAX_CINEMATIC_CAST} characters`);
  }
  const seen = new Set<string>();
  return rows.map((row) => {
    const name = row.name.trim();
    if (!name || !row.voiceId) throw new Error("Each character needs a name and saved voice");
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Character name "${name}" is duplicated`);
    seen.add(key);
    const voice = voices.find((item) => item.id === row.voiceId);
    const asset = voice ? assets.find((item) => item.id === voice.refAssetId) : undefined;
    if (!voice || !asset) throw new Error(`@${name} has no available voice reference`);
    if (asset.duration > MAX_SEED_REFERENCE_SECONDS) {
      throw new Error(`@${name} reference is over ${MAX_SEED_REFERENCE_SECONDS}s. Save a shorter region as that voice.`);
    }
    return { id: row.id, name, url: asset.url, duration: asset.duration };
  });
}

export function resolvePromptCast(
  prompt: string,
  cast: CinematicCastRef[]
): { prompt: string; audioUrls: string[] } {
  const mentioned = findMentionedTargets(prompt, cast);
  const rewritten = replaceMentionsWithAudioTags(prompt, mentioned);
  return {
    prompt: stripUnknownMentionMarkers(rewritten),
    audioUrls: mentioned.map((item) => item.url)
  };
}
```

- [ ] **Step 6: Run helper tests**

Run:

```bash
npx vitest run src/lib/mentions.test.ts src/lib/cinematic-cast.test.ts
```

Expected: both files PASS.

---

### Task 2: Cast-aware cinematic spec validation

**Files:**
- Modify: `src/lib/cinematic-spec.ts`
- Modify: `src/lib/cinematic-spec.test.ts`

- [ ] **Step 1: Replace showcase fixture copy**

Change the generic test fixture closing line from `"Written, not recorded."` to a
thematic line such as `"Some fires refuse to die."`.

- [ ] **Step 2: Write failing cast-mode tests**

Add:

```ts
it("keeps known cast aliases and removes the generated anchor in cast mode", () => {
  const spec = validateCinematicSpec(
    {
      name: "Scene",
      anchor: { prompt: "generated narrator" },
      voice: [{
        model: "seed-scene",
        clone: true,
        useAnchor: true,
        prompt: "[@ room] @Queen answers @Warlord while @Ghost listens."
      }],
      layers: []
    },
    { characterNames: ["Queen", "Warlord"] }
  );

  expect(spec.anchor).toBeUndefined();
  expect(spec.voice[0].clone).toBe(false);
  expect(spec.voice[0].useAnchor).toBe(false);
  expect(spec.voice[0].prompt).toContain("@Queen");
  expect(spec.voice[0].prompt).toContain("@Warlord");
  expect(spec.voice[0].prompt).toContain("Ghost");
  expect(spec.voice[0].prompt).not.toContain("@Ghost");
});
```

Keep the existing no-cast anchor test to prove backward compatibility.

- [ ] **Step 3: Run the test and verify failure**

Run:

```bash
npx vitest run src/lib/cinematic-spec.test.ts
```

Expected: FAIL because `validateCinematicSpec` does not accept context and does not
disable the anchor in cast mode.

- [ ] **Step 4: Implement validation context**

Add:

```ts
export interface CinematicSpecContext {
  characterNames?: string[];
}
```

Change the signature to:

```ts
export function validateCinematicSpec(
  raw: unknown,
  context: CinematicSpecContext = {}
): CinematicSpec
```

Normalize unique non-empty character names to at most three. In cast mode:

```ts
const castTargets = characterNames.map((name, index) => ({
  id: `cast_${index}`,
  name
}));
const sanitizeCastPrompt = (prompt: string) => {
  const withoutAnchorTags = stripAnchorTags(prompt);
  const known = findMentionedTargets(withoutAnchorTags, castTargets);
  const tagged = replaceMentionsWithAudioTags(withoutAnchorTags, known);
  const plain = stripUnknownMentionMarkers(tagged);
  return known.reduce(
    (text, target, index) =>
      text.replaceAll(`@Audio${index + 1}`, `@${target.name}`),
    plain
  );
};
```

Suppress `anchor`, `clone`, and `useAnchor` when `characterNames.length > 0`, and run
`sanitizeCastPrompt` for voice and optional outro prompts. Keep the current no-cast
branch unchanged.

- [ ] **Step 5: Run cinematic spec tests**

Run:

```bash
npx vitest run src/lib/cinematic-spec.test.ts
```

Expected: PASS.

---

### Task 3: Attach external cast references in the runner

**Files:**
- Modify: `src/lib/cinematic-runner.ts`
- Modify: `src/lib/cinematic-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Add a cast-mode spec with no anchor and one Seed Scene prompt:

```ts
const castSpec = validateCinematicSpec(
  {
    name: "CAST",
    voice: [{
      model: "seed-scene",
      prompt: "[A hall.] @Queen says: \"Stand.\" @Warlord replies: \"Never.\""
    }],
    layers: []
  },
  { characterNames: ["Queen", "Warlord"] }
);
```

Run it with:

```ts
cast: [
  { id: "q", name: "Queen", url: "https://q.wav", duration: 8 },
  { id: "w", name: "Warlord", url: "https://w.wav", duration: 9 },
  { id: "n", name: "Narrator", url: "https://n.wav", duration: 7 }
]
```

Assert:

```ts
expect(calls[0]).toMatchObject({
  modelId: "seed-scene",
  input: {
    prompt: "[A hall.] @Audio1 says: \"Stand.\" @Audio2 replies: \"Never.\"",
    audio_urls: ["https://q.wav", "https://w.wav"]
  }
});
expect(calls.some((call) => call.input.prompt === "generated narrator")).toBe(false);
```

Add a second assertion that a prompt mentioning only `@Narrator` gets only
`["https://n.wav"]`.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npx vitest run src/lib/cinematic-runner.test.ts
```

Expected: FAIL because `RunCinematicOptions` has no `cast` and prompts are not
rewritten.

- [ ] **Step 3: Implement per-job cast mapping**

Extend:

```ts
export interface RunCinematicOptions {
  cast?: CinematicCastRef[];
  // existing fields...
}
```

Use a single input helper:

```ts
const withVoiceRefs = (
  prompt: string,
  useAnchor: boolean
): Record<string, unknown> => {
  if (opts.cast?.length) {
    const resolved = resolvePromptCast(prompt, opts.cast);
    return {
      prompt: resolved.prompt,
      enhance: false,
      ...(resolved.audioUrls.length ? { audio_urls: resolved.audioUrls } : {})
    };
  }
  return withAnchor({ prompt, enhance: false }, useAnchor);
};
```

Do not generate `spec.anchor` when `opts.cast` is non-empty. Use `withVoiceRefs` for
every voice segment and optional outro. Leave score/layers/Whisper/assembly untouched.

- [ ] **Step 4: Run runner and assembly tests**

Run:

```bash
npx vitest run src/lib/cinematic-runner.test.ts src/lib/cinematic-assemble.test.ts
```

Expected: PASS.

---

### Task 4: Make planner instructions cast-aware and testable

**Files:**
- Create: `src/lib/cinematic-plan-prompt.ts`
- Create: `src/lib/cinematic-plan-prompt.test.ts`
- Modify: `src/app/api/cinematic/plan/route.ts`

- [ ] **Step 1: Write failing planner prompt tests**

Assert that the generic prompt says closing lines are optional and forbidden from
adding showcase meta copy automatically. For cast mode assert:

```ts
const prompt = buildCinematicPlannerSystem(["Queen", "Warlord"]);
expect(prompt).toContain("AVAILABLE CAST: @Queen, @Warlord");
expect(prompt).toContain("Do not create an anchor");
expect(prompt).toContain("Use only the available cast for every speaking role");
```

Also verify `normalizeCharacterNames([" Queen ", "queen", "Warlord", "Extra", "Fourth"])`
returns `["Queen", "Warlord", "Extra"]`.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npx vitest run src/lib/cinematic-plan-prompt.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Extract planner prompt construction**

Move `EXAMPLES` and the base system prompt from the route into
`src/lib/cinematic-plan-prompt.ts`. Export:

```ts
export function normalizeCharacterNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length === 3) break;
  }
  return names;
}

export function buildCinematicPlannerSystem(characterNames: string[]): string {
  const castRules = characterNames.length
    ? `\nCAST MODE:
- AVAILABLE CAST: ${characterNames.map((name) => `@${name}`).join(", ")}
- Do not create an anchor. Do not set clone or useAnchor.
- Use only the available cast for every speaking role.
- Put the exact @Character alias in every Seed voice/scene speaker definition.
- If narration is needed, it must use a supplied @Narrator character.`
    : "";
  return `${BASE_SYSTEM}${castRules}`;
}
```

Keep the current generic prohibition against automatic AI/written/not-recorded copy.

- [ ] **Step 4: Wire the route**

Parse:

```ts
const body = (await request.json().catch(() => null)) as {
  brief?: string;
  characterNames?: unknown;
} | null;
const characterNames = normalizeCharacterNames(body?.characterNames);
```

Pass `buildCinematicPlannerSystem(characterNames)` into fal and validate with:

```ts
validateCinematicSpec(raw, { characterNames })
```

Use the same names on the retry path.

- [ ] **Step 5: Run planner, spec, and protected-route tests**

Run:

```bash
npx vitest run src/lib/cinematic-plan-prompt.test.ts src/lib/cinematic-spec.test.ts src/app/api/protected-routes.test.ts
```

Expected: PASS.

---

### Task 5: Add optional character rows to Compose

**Files:**
- Modify: `src/components/generate-fields.tsx`
- Modify: `src/components/generate-panel.tsx`
- Modify: `src/app/styles/generate.css`

- [ ] **Step 1: Generalize the mention textarea**

Export `MentionTextarea` and change its `voices: Voice[]` property to
`targets: MentionTarget[]`. Keep behavior and accessibility unchanged:

```ts
export function MentionTextarea({
  value,
  onChange,
  targets,
  maxLength,
  className = "textarea",
  placeholder,
  disabled
}: {
  value: string;
  onChange: (next: string) => void;
  targets: MentionTarget[];
  maxLength?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) { /* existing autocomplete logic using targets */ }
```

Update `FieldEditor` to pass `targets={voices}`.

- [ ] **Step 2: Add Compose character state**

In `GeneratePanel`:

```ts
const [characters, setCharacters] = React.useState<ComposeCharacter[]>([]);
const characterTargets = characters
  .filter((row) => row.name.trim())
  .map((row) => ({ id: row.id, name: row.name.trim() }));
```

Change `onGenerateBrief` to accept `ComposeCharacter[]` after the brief. Pass a copy
from `runCompose`.

- [ ] **Step 3: Render the optional section**

Add a compact disclosure below the lead copy and above the description:

```tsx
<details className="compose-characters">
  <summary>
    <span>Characters</span>
    <span>{characters.length ? `${characters.length}/3` : "Optional"}</span>
  </summary>
  <div className="compose-character-list">
    {characters.map((character, index) => (
      <div className="compose-character-row" key={character.id}>
        <input
          className="input"
          aria-label={`Character ${index + 1} name`}
          placeholder={`Character ${index + 1}`}
          value={character.name}
          onChange={(event) => updateCharacter(character.id, { name: event.target.value })}
        />
        <select
          className="select"
          aria-label={`Character ${index + 1} saved voice`}
          value={character.voiceId}
          onChange={(event) => updateCharacter(character.id, { voiceId: event.target.value })}
        >
          <option value="">Saved voice</option>
          {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
        </select>
        <button className="icon-button" type="button" aria-label={`Remove ${character.name || `character ${index + 1}`}`}>
          ×
        </button>
      </div>
    ))}
    {characters.length < 3 ? (
      <button className="button compact ghost" type="button" onClick={addCharacter}>
        + Character
      </button>
    ) : null}
  </div>
</details>
```

Replace the plain Compose textarea with:

```tsx
<MentionTextarea
  className="compose-input"
  value={brief}
  onChange={setBrief}
  targets={characterTargets}
  disabled={composeBusy}
  placeholder="e.g. @Host opens the show, then @Guest answers"
/>
```

Render compact alias chips below it. Do not add inline helper prose; use `InfoTip`
for the narrator/cast explanation.

- [ ] **Step 4: Add desktop-density CSS**

Use grid rows, 28px controls, flat borders, no shadows, no gradients:

```css
.compose-characters {
  border: 1px solid var(--border);
  background: var(--surface);
}

.compose-characters summary,
.compose-character-row {
  min-height: 28px;
}

.compose-character-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
  gap: var(--space-xs);
}
```

Use existing surface, border, text, and accent tokens for the remaining declarations.

- [ ] **Step 5: Verify UI type safety**

Run:

```bash
npm run typecheck
```

Expected: PASS after Studio's callback signature is updated in Task 6; a temporary
callback mismatch is acceptable until that task is complete.

---

### Task 6: Resolve cast locally and run Compose

**Files:**
- Modify: `src/components/studio.tsx`

- [ ] **Step 1: Update `generateCinematic`**

Change the signature:

```ts
async function generateCinematic(
  brief: string,
  characters: ComposeCharacter[],
  onProgress: (p: CinematicProgress) => void,
  signal: AbortSignal
)
```

Resolve before any network call:

```ts
if (!snapshot) throw new Error("Project is not ready");
const cast = resolveComposeCast(characters, snapshot.voices, snapshot.assets);
```

Send aliases only:

```ts
body: JSON.stringify({
  brief,
  characterNames: cast.map((character) => character.name)
})
```

Pass local references to the runner:

```ts
const snap = await runCinematic(data.spec, projectId, {
  cast,
  onProgress,
  signal
});
```

Keep status reporting and `addProject` behavior unchanged.

- [ ] **Step 2: Run focused unit and type checks**

Run:

```bash
npx vitest run src/lib/cinematic-cast.test.ts src/lib/cinematic-spec.test.ts src/lib/cinematic-runner.test.ts
npm run typecheck
```

Expected: all PASS.

---

### Task 7: Make the showcase generator explicitly showcase-only

**Files:**
- Modify: `scripts/make-showcase-cinematics.mjs`
- Modify: `.claude/skills/cinematic-audio/SKILL.md`
- Modify: `.claude/skills/seed-scene-prompting/SKILL.md`
- Modify: `.claude/skills/seed-voice-cloning/SKILL.md`
- Modify: `.claude/skills/audio-loudness-ducking/SKILL.md`
- Modify comments in `src/lib/cinematic-spec.ts`, `src/lib/cinematic-runner.ts`, `src/lib/cinematic-assemble.ts`, and `src/lib/loudness.ts`

- [ ] **Step 1: Mark the hard-coded generator as showcase-only**

The renamed file retains the six curated showcase specs and their signature closing
lines. Update its header and usage text:

```js
// SHOWCASE-ONLY generator for the six curated cinematic demos.
// Product Compose does not call this file and does not add these signature lines.
//
// Usage:
//   node scripts/make-showcase-cinematics.mjs [baseUrl] [--only=trailer]
```

- [ ] **Step 2: Update generic cinematic guidance**

Rewrite the cinematic skill's default path to:

1. author through the Compose planner/spec;
2. execute with `runCinematic`;
3. use `scripts/make-showcase-cinematics.mjs` only when regenerating curated demos.

Remove any generic requirement for a “written, not recorded” signature. Update
cross-references in the three technique skills to the renamed showcase script where
they are discussing its concrete implementation.

- [ ] **Step 3: Update source comments**

Replace statements that call the old script the generic source of truth with neutral
language such as “shares the cinematic loudness/assembly algorithm with the
showcase generator.” No runtime behavior changes.

- [ ] **Step 4: Verify ownership by search**

Run:

```bash
rg -n "make-.*cinematic.*\\.mjs" .claude src scripts docs AGENTS.md
rg -ni "written.{0,24}not[- ]recorded|not (a single|one)|never (spoken|recorded)|ever (spoken|recorded)" src scripts .claude docs
```

Expected:

- cinematic script references use the explicitly showcase-owned filename;
- signature copy appears only in `scripts/make-showcase-cinematics.mjs` and explicitly
  showcase-scoped documentation;
- no generic planner fixture or skill prescribes the signature.

---

### Task 8: Full verification

**Files:**
- No additional files unless verification exposes a defect.

- [ ] **Step 1: Run the full unit suite**

Run:

```bash
npm run test
```

Expected: all tests PASS.

- [ ] **Step 2: Run TypeScript validation**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: Next.js production build PASS.

- [ ] **Step 4: Browser-smoke both Compose modes**

Start the app with valid local credentials, then verify:

1. Zero-character Compose still plans and exposes the existing generated-anchor path.
2. Add `Queen` and `Warlord`, select two saved voices, type both aliases with
   autocomplete, and submit.
3. The planner request contains names but no URLs.
4. Seed Scene receives rewritten `@Audio1`/`@Audio2` and exactly two `audio_urls`.
5. The resulting project loads and timeline playback advances.

Use mocked jobs for UI interaction if avoiding live model cost; run live only with
explicit user approval.

- [ ] **Step 5: Review working tree**

Run:

```bash
git status --short
git diff --check
```

Expected: no whitespace errors; only scoped source, tests, docs, and the intentional
script rename are present.
