# Audio Studio

Audio-only creator studio for model-routed generation, prompt enhancement,
voice references, non-destructive transforms, a timeline, and export.

## Run

```bash
npm install
npm run dev
```

Set `FAL_KEY` for model calls. Without it, `/api/jobs` returns a clear
configuration error and no mock audio is generated.

## Scope

- Audio only. No video ingest.
- Dark/OLED Nothing-inspired interface.
- Local-first project graph stored in IndexedDB.
- Server API wraps fal jobs without a custom worker in V1.
