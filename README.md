# Audio Studio

Audio Studio is an open-source, audio-only creator studio powered by fal.ai.
Build complete pieces from a brief, keep character voices consistent with `@`
mentions, edit on a multitrack timeline, and export the result as WAV. Your
project graph stays in the browser and is not sent to a hosted database.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/egebese/audio-studio)

## See it in action

[![Audio Studio generated multi-character scene](public/featured/seed-cast-scene.webp)](public/featured/seed-cast-scene.mp4)

Click the image to watch a generated multi-character scene.

## What you can make

- Compose complete pieces from a brief.
- Direct a cast of up to three aliases mapped to saved voices with
  `@Character` mentions.
- Generate and transform speech, music, and sound effects, including extend,
  inpaint, dub, restyle, and voice change.
- Edit on a real timeline with move, trim, split, fade, gain, mute, solo, and
  regions, all non-destructively.
- Transcribe and diarize speech, export captions, and save reusable voice
  references.
- Keep projects locally in IndexedDB and export finished mixes as WAV.

## Self-host in three commands

The supported V1 setup is one long-lived container with one replica. You need
Docker with Docker Compose v2 and a fal API key.

```bash
git clone https://github.com/egebese/audio-studio.git
cd audio-studio
./install.sh
```

The installer creates a private `.env`, generates the studio login, starts
Docker Compose, and serves the app at `http://127.0.0.1:3000`. Your `FAL_KEY`
pays for live model jobs; the studio does not generate mock audio.

See [the self-hosting guide](docs/self-hosting.md) for manual Compose setup,
HTTPS, upgrades, Render, Railway, Fly.io, storage behavior, and troubleshooting.

## How it works

- The Next.js server handles authentication and wraps fal model jobs.
- The browser stores the project graph in IndexedDB.
- Audio remains remote, so there is no project database or persistent container
  volume to provision.
- Generated and transformed assets preserve immutable lineage instead of
  overwriting their sources.
- Active jobs live in server memory, which requires one always-on process and
  one replica.

Serverless runtimes, autoscaling, multiple replicas, and scale-to-zero are
explicitly unsupported in V1.

## Development

Use Node.js 22.

```bash
npm ci
STUDIO_AUTH_DISABLED=true npm run dev
```

Set `FAL_KEY` to run live model jobs. Production ignores the authentication
bypass and requires `STUDIO_PASSWORD` plus a `STUDIO_SESSION_SECRET` of at least
32 random bytes.

Verify changes with:

```bash
npm run typecheck
npm run test
npm run build
```

## Security and data

Put a trusted HTTPS reverse proxy in front of the app before exposing it to the
internet; plain HTTP exposes the password and session in transit. Project data
is scoped to the exact origin and browser profile, so changing the hostname,
scheme, port, or browser can make the studio appear empty. Wait for active jobs
to finish before restarting because job state is held in memory.

See [project data and backups](docs/self-hosting.md#project-data-and-backups) for
storage and recovery details.

## Contributing

Open an issue before a substantial pull request. Include a minimal reproduction
and the version you tested. Remove API keys, passwords, personal audio, and
private URLs from issues, logs, screenshots, and commits.

## License

Licensed under [Apache-2.0](LICENSE).
