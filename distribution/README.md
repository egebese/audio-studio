# Public release pipeline

The private repository is canonical. A `v*` tag runs
`.github/workflows/publish-public.yml`, verifies a fail-closed export, and
replaces `fal-ai-community/audio-studio` with that snapshot. Private git
history and everything under `distribution/` stay out of the mirror.

## One-time GitHub setup

1. Host this source repository on GitHub.
2. Create `fal-ai-community/audio-studio` with `main` as its default branch.
3. Create a `public-release` environment in the private repository.
4. Add `PUBLIC_REPO_TOKEN` to that environment.

The token owner must be allowed to push to the public repository and publish
`ghcr.io/fal-ai-community/audio-studio`. Grant only the permissions required:

- public repository Contents: read and write
- public repository Workflows: read and write, because the mirror contains CI
- package write access for the GHCR namespace

Use a dedicated bot identity where possible. Main-branch protection on the
public mirror must allow that identity to perform the atomic release push.

## Release

Make `package.json` version `X.Y.Z`, verify locally, then push tag `vX.Y.Z`.
The tag and package version must match exactly.

Before tagging:

```bash
node distribution/export-public.mjs --dry-run
npm run typecheck
npm test
npm run build
```

The workflow tests both the private source and the sanitized export before it
pushes the public branch and matching tag. The image job then publishes
`vX.Y.Z` and `latest` for `linux/amd64` and `linux/arm64`.

If source publication succeeds but image publication fails, use GitHub's
"Re-run failed jobs" action. Do not rerun the successful source job because
public release tags are immutable.

No workflow in this directory creates repositories, changes repository
settings, publishes a Railway template, or bypasses branch protection.
