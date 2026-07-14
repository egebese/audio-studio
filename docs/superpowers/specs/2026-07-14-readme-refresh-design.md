# README Refresh Design

## Goal

Turn the repository README into a product-first entry point that explains what
Audio Studio does, gets a self-hoster running quickly, and states the V1
operational constraints without making the page feel like deployment
documentation.

## Structure

1. A concise product statement and deployment badge.
2. A prominent "See it in action" area using a tracked WebP preview linked to
   its matching MP4. This works reliably on GitHub while avoiding unsupported
   embedded-video behavior.
3. A capability overview covering Compose, optional aliased character voices
   with `@` mentions, timeline editing, transforms, voice references, and WAV
   export.
4. A three-command Docker self-host path using the current personal repository
   URL.
5. A short explanation of the local-first architecture, fal.ai dependency,
   authentication, and single-process/single-replica V1 constraint.
6. Development and verification commands.
7. Links to detailed self-hosting and contribution guidance, followed by the
   Apache-2.0 license.

## Media

Use `public/featured/seed-cast-scene.webp` as the clickable preview and
`public/featured/seed-cast-scene.mp4` as the destination. It demonstrates the
new multi-character voice workflow and is already part of the public release
allowlist. A future full-product promo can replace these two paths without
changing the README layout.

## Repository Links

Use `https://github.com/egebese/audio-studio` while the repository is owned by
the personal account. GitHub redirects these links after a later transfer to
`fal-ai-community`, and the README can then be updated to the canonical
organization URL.

## Acceptance Criteria

- A new visitor can identify the product, watch an example, and start a local
  instance without opening another document.
- Character aliases and `@`-mentioned saved voices are visible as a headline
  product capability.
- Security, browser-local storage, live fal.ai costs, and unsupported
  serverless/multi-replica deployment are explicit.
- The README contains no broken local asset links or references to an
  unavailable organization repository.
- Documentation-only verification passes and the feature branch is merged
  into `main` without a merge commit when possible.
