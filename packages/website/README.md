# @selvajs/website

Marketing website for Selva (selva.app). Fully static SvelteKit site —
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

Output is static HTML/CSS/JS in `build/`, deployable to any static host.
