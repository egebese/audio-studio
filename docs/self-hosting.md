# Self-hosting Audio Studio

Audio Studio V1 is a single-user, single-process application. It stores project
metadata in the browser's IndexedDB and sends media to fal.storage. The server
keeps active job state in memory, so run exactly one replica and keep it alive
until every model job has finished.

## Requirements

- Docker Engine with Docker Compose v2
- A fal account and `FAL_KEY`
- Outbound HTTPS access to fal.ai
- HTTPS before exposing the service to the public internet

There is no database or persistent Docker volume to provision.

## Quick install

```bash
git clone https://github.com/fal-ai-community/audio-studio.git
cd audio-studio
./install.sh
```

The installer reads `FAL_KEY` without echoing it, creates `.env` with mode
`0600`, generates `STUDIO_PASSWORD` and `STUDIO_SESSION_SECRET`, and starts the
container. It never prints those credentials. Read the generated
`STUDIO_PASSWORD` from `.env` locally, then open `http://127.0.0.1:3000`.

If `.env` already exists, the installer validates and reuses it without
overwriting it. To configure manually, copy `.env.example`, replace every
required placeholder, make the session secret at least 32 random bytes, and
run:

```bash
docker compose pull
docker compose up -d --no-build
```

If the release image is unavailable, build the checked-out source:

```bash
docker compose build audio-studio
docker compose up -d --no-build
```

## Configuration

Required:

- `FAL_KEY`: pays for uploads and model jobs on this instance.
- `STUDIO_PASSWORD`: the single-user login password.
- `STUDIO_SESSION_SECRET`: at least 32 random bytes used to sign sessions.

Optional:

- `OPENAI_API_KEY`: direct fallback for text-only naming and prompt features.
- `AUDIO_STUDIO_NAME_MODEL`: model override for asset naming.
- `AUDIO_STUDIO_PROMPT_MODEL`: model override for prompt enhancement.
- `AUDIO_STUDIO_CINEMATIC_MODEL`: model override for cinematic planning.
- `BIND_ADDRESS`: host bind address; defaults to `127.0.0.1`.
- `PORT`: published host port; defaults to `3000`.
- `AUDIO_STUDIO_VERSION`: image tag; defaults to `latest`.

`GET /api/health` returns `200` only when `FAL_KEY` and production auth are
configured. It reports configuration state, never secret values.

## HTTPS and network exposure

Compose binds to localhost by default. Keep that default and put Caddy, nginx,
Traefik, or another trusted reverse proxy in front of the app. Terminate HTTPS
at the proxy and forward `X-Forwarded-Proto`. Do not publish port 3000 directly
to the internet over plain HTTP: the login protects fal spend, but TLS protects
the password and session in transit.

To make the service reachable on a private LAN, set `BIND_ADDRESS=0.0.0.0` only
when the host firewall and network are trusted.

## Upgrades and rollback

Wait for all active jobs to finish before restarting; in-memory job state does
not survive a deploy.

```bash
git pull --ff-only
docker compose pull
docker compose up -d --no-build
```

For a rollback, set `AUDIO_STUDIO_VERSION` in `.env` to a published `v*` tag,
then run the pull and up commands again. Keep the hostname, scheme, and port
stable across upgrades.

## Project data and backups

Project graphs are local to IndexedDB in the current browser profile. The
server does not hold a project database, and mounting a Docker volume does not
back projects up. Browser storage is scoped to the same origin, so changing
from an IP address to a domain, changing the port, or switching browsers makes
the studio appear empty even though remote audio may still exist.

V1 has no server-side backup or cross-browser sync. Preserve the browser
profile and stable URL, and treat clearing site data as destructive.

## Container hosts

### Render

Use the Deploy to Render button in the README. The Blueprint builds the
Dockerfile, selects an always-on Starter service, disables automatic deploys,
and pins `numInstances` to one. Enter `FAL_KEY` and a strong
`STUDIO_PASSWORD`; Render generates `STUDIO_SESSION_SECRET`.

### Railway

Create a service from
`https://github.com/fal-ai-community/audio-studio`. `railway.json` selects the
Dockerfile, `/api/health`, and one replica. Add `FAL_KEY`,
`STUDIO_PASSWORD`, and a random 32-byte `STUDIO_SESSION_SECRET` in Railway's
Variables panel. Keep application sleeping and scale-to-zero disabled.

A true Deploy on Railway button requires a published Railway template ID. The
repository config is ready for that template, but a template must be published
from the owning Railway workspace before a button can be added.

### Fly.io

The included `deploy/fly.toml` disables machine autostop and keeps one machine
running because background jobs continue after the request returns.

```bash
fly launch --config deploy/fly.toml --copy-config --no-deploy
fly secrets set --config deploy/fly.toml FAL_KEY=... STUDIO_PASSWORD=... STUDIO_SESSION_SECRET=...
fly scale count 1 --config deploy/fly.toml
fly deploy --config deploy/fly.toml
```

Use local secret values rather than committing them. Confirm `fly scale show`
reports one machine after deployment.

## Unsupported hosts

Vercel Functions, Cloudflare Workers, other serverless runtimes, multiple
replicas, autoscaling, and scale-to-zero are unsupported in V1. They can stop a
fire-and-forget job after the HTTP response or route a poll to a different
process that does not have the in-memory job record.

Long-lived single-container services are supported: Docker Compose, Render,
Railway, and Fly.io with the settings above.

## Troubleshooting

```bash
docker compose ps
docker compose logs --tail 100 audio-studio
curl -i http://127.0.0.1:3000/api/health
```

- `503` from health: verify `FAL_KEY`, `STUDIO_PASSWORD`, and a 32-byte
  `STUDIO_SESSION_SECRET`.
- Login loops behind HTTPS: verify the proxy sends `X-Forwarded-Proto: https`.
- A job disappears after deploy: the process restarted before the job
  completed; rerun it after the instance is healthy.
- The studio appears empty at a new URL: return to the original browser origin.
