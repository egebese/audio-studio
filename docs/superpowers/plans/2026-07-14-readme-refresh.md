# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal README with a product-first repository entry point, a clickable video preview, an accurate self-hosting path, and concise operational guidance.

**Architecture:** Keep detailed deployment instructions in `docs/self-hosting.md` and use the root README as the product overview and quick start. Reference only tracked repository media so the page works on GitHub and in sanitized public exports.

**Tech Stack:** Markdown, GitHub-rendered HTML/Markdown, Docker Compose, Next.js.

---

### Task 1: Rewrite the root README

**Files:**
- Modify: `README.md`
- Reference: `docs/self-hosting.md`
- Reference: `public/featured/seed-cast-scene.webp`
- Reference: `public/featured/seed-cast-scene.mp4`

- [ ] **Step 1: Replace the README with the approved product-first content**

Use this exact structure and copy:

```markdown
# Audio Studio

An open-source, audio-only creator studio powered by fal.ai. Generate complete
pieces from a brief, direct consistent character voices with `@` mentions, edit
on a multitrack timeline, and export a finished WAV without sending the project
graph to a hosted database.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/egebese/audio-studio)

## See it in action

[![Watch the multi-character voice demo](public/featured/seed-cast-scene.webp)](public/featured/seed-cast-scene.mp4)

Click the preview to watch a generated multi-character scene.

## What you can make

- **Compose complete pieces** — describe a trailer, scene, podcast, ad,
  meditation, or sound-rich story and let the planner build the tracks.
- **Direct a cast** — map up to three character aliases to saved voice
  references, then use `@Character` in the description.
- **Generate and transform audio** — create speech, music, and SFX; extend,
  inpaint, dub, restyle, or change voices through schema-driven model tools.
- **Edit on a real timeline** — move, trim, split, fade, gain-stage, mute,
  solo, select regions, and keep every derived result non-destructive.
- **Work with speech** — transcribe, inspect diarized speakers, create
  captions, and save clips or regions as reusable voice references.
- **Finish locally** — projects live in the browser's IndexedDB and export as
  WAV from the studio.

## Self-host in three commands

Audio Studio V1 runs as one long-lived container with one replica. You need
Docker Compose and a [fal.ai API key](https://fal.ai/dashboard/keys).

```bash
git clone https://github.com/egebese/audio-studio.git
cd audio-studio
./install.sh
```

The installer creates a private `.env`, generates login credentials, and starts
the studio at `http://127.0.0.1:3000`. Your `FAL_KEY` pays for uploads and live
model jobs; the app does not generate mock audio when it is missing.

For HTTPS, manual Compose setup, upgrades, rollback, Render, Railway, Fly.io,
and troubleshooting, read the [self-hosting guide](docs/self-hosting.md).

## How it works

- The Next.js server protects the studio and wraps fal.ai uploads and jobs.
- Project metadata stays in IndexedDB in the current browser profile.
- Audio assets remain remote; no database or Docker volume is required.
- Generated and transformed outputs create new assets and preserve lineage.
- Active job state is in memory, so V1 requires one always-on process and one
  replica.

Because of that final constraint, serverless, autoscaling, multi-replica, and
scale-to-zero deployments are not supported in V1.

## Development

Requires Node.js 22.

```bash
npm ci
STUDIO_AUTH_DISABLED=true npm run dev
```

Set `FAL_KEY` before running live model jobs. Production ignores
`STUDIO_AUTH_DISABLED`; configure `STUDIO_PASSWORD` and a random
`STUDIO_SESSION_SECRET` of at least 32 bytes.

Verify changes with:

```bash
npm run typecheck
npm run test
npm run build
```

## Security and data

- Do not expose port 3000 directly over plain HTTP; terminate HTTPS at a trusted
  reverse proxy.
- Browser storage is scoped to the exact origin and browser profile. Changing
  the hostname, scheme, port, or browser makes local projects appear empty.
- Wait for active jobs to finish before restarting because in-memory job state
  does not survive a deploy.

See [the full data and backup notes](docs/self-hosting.md#project-data-and-backups)
before treating a self-hosted instance as durable storage.

## Contributing

Open an issue before a substantial pull request so the direction can be
confirmed first. Include reproduction steps and versions, and remove API keys,
passwords, personal audio, and private media URLs from logs.

## License

Licensed under the [Apache License 2.0](LICENSE).
```

- [ ] **Step 2: Verify every local README link resolves**

Run:

```bash
test -f public/featured/seed-cast-scene.webp
test -f public/featured/seed-cast-scene.mp4
test -f docs/self-hosting.md
test -f LICENSE
```

Expected: exit code `0` with no output.

- [ ] **Step 3: Check Markdown hygiene and repository references**

Run:

```bash
git diff --check
rg 'fal-ai-community/audio-studio' README.md
```

Expected: `git diff --check` exits `0`; `rg` returns no matches.

- [ ] **Step 4: Commit the README**

```bash
git add README.md docs/superpowers/plans/2026-07-14-readme-refresh.md
git commit -m "Improve the public README"
```

### Task 2: Merge and publish

**Files:**
- No file changes.

- [ ] **Step 1: Push the completed feature branch**

```bash
git push origin feature/compose-character-voices
```

Expected: the remote branch advances to the README commit.

- [ ] **Step 2: Fast-forward local main**

```bash
git switch main
git merge --ff-only feature/compose-character-voices
```

Expected: `main` points to the same commit without a merge commit.

- [ ] **Step 3: Push main and verify**

```bash
git push origin main
git status --short --branch
```

Expected: `main` tracks `origin/main` and the working tree is clean.
