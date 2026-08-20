# @selvajs/website

Marketing website for Selva (selva.dev). Fully static SvelteKit site —
every route is prerendered to HTML via `@sveltejs/adapter-static`.

Shares the design system (`@selvajs/ui` theme tokens, dark mode) and tooling
config (`@selvajs/config`) with the rest of the monorepo.

## Develop

```bash
pnpm --filter @selvajs/website dev     # or: pnpm dev:website
```

## Build

```bash
pnpm --filter @selvajs/website build   # or: pnpm build:website
```

`scripts/build-api-docs.mjs` runs first, generating the API reference pages; then
Vite prerenders everything into `build/`, deployable to any static host.

## Deploy

Firebase Hosting, project `selva-website` (`.firebaserc`). Deploys are manual —
no CI job publishes the site.

```bash
pnpm --filter @selvajs/website deploy           # build + publish live
pnpm --filter @selvajs/website deploy:preview   # build + temporary preview URL
```

First time on a machine: `pnpm --filter @selvajs/website exec firebase login`.
Hosting also has to be enabled once for the project in the Firebase console.

Test the built site locally exactly as Firebase serves it:

```bash
pnpm --filter @selvajs/website exec firebase emulators:start --only hosting
```

Two things in `firebase.json` are easy to break:

- **Header rules are last-match-wins.** The catch-all `**` no-cache rule comes
  first, `/_app/immutable/**` second — reverse them and the hashed assets lose
  their year-long cache. Verify with `curl -I` against the emulator.
- **`cleanUrls` is load-bearing.** Internal links are extensionless (`/docs`,
  `/architecture`); without it every one of them 404s.

`build/404.html` comes from the prerendered `src/routes/404/+page.svelte`, not
from `+error.svelte` — the error component only handles client-side navigation
and emits no file. Firebase serves that file for unmatched paths.
