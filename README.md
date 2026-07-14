# Audio Studio

Audio-only creator studio for model-routed generation, prompt enhancement,
voice references, non-destructive transforms, a timeline, and export.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/fal-ai-community/audio-studio)

## Self-host

The supported V1 deployment is one long-lived container with one replica.
Projects stay in the browser's IndexedDB and media is stored through fal.ai, so
there is no server database or volume to provision.

```bash
git clone https://github.com/fal-ai-community/audio-studio.git
cd audio-studio
./install.sh
```

The installer creates a private `.env`, generates the studio login credentials,
and starts Docker Compose. A `FAL_KEY` is required and belongs to the person
hosting the instance.

See [the self-hosting guide](docs/self-hosting.md) for manual Compose setup,
HTTPS, upgrades, Render, Railway, Fly.io, storage behavior, and troubleshooting.

## Development

```bash
npm ci
npm run dev
```

Set `FAL_KEY` for model calls. For an explicitly unprotected local development
session, set `STUDIO_AUTH_DISABLED=true`; production ignores that bypass.
Without `FAL_KEY`, `/api/jobs` returns a clear configuration error and no mock
audio is generated.

## Scope

- Audio only. No video ingest.
- Dark/OLED Nothing-inspired interface.
- Local-first project graph stored in IndexedDB.
- Server API wraps fal jobs without a custom worker in V1.
- One process and one replica; Vercel, Cloudflare Workers, serverless,
  autoscaling, and scale-to-zero are unsupported in V1.

Licensed under Apache-2.0.
