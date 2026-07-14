# Contributing

This repository is a release mirror. Its `main` branch is replaced by a
verified snapshot from the private source repository for every `v*` release.
Direct commits and pull requests against generated files can therefore be
overwritten by the next release.

For bugs and feature requests, open a GitHub issue with:

- the Audio Studio version
- the deployment method and Node/Docker version
- exact reproduction steps
- logs with keys, passwords, media URLs, and personal audio removed

For a code change, open an issue before a pull request so maintainers can
confirm the change and port it to the source repository. Forks remain fully
permitted under Apache-2.0.

Never include `FAL_KEY`, `STUDIO_PASSWORD`, `STUDIO_SESSION_SECRET`, uploaded
audio, or `.env` files in an issue or pull request.
