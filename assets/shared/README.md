# assets/shared

Canonical copies of binary assets used by more than one package. Files here are
the source of truth — don't edit the copies inside individual packages' `static/`
directories, they're generated.

## How it works

`scripts/sync-shared-assets.js` copies each asset listed in its `MANIFEST` into
the `static/` directory of every package that needs it. SvelteKit/Vite only serve
files physically present under `static/`, so this repo doesn't rely on symlinks
(unreliable across git/Windows/CI).

The copy runs automatically via each consuming package's `predev`/`prebuild` npm
script. To run it manually:

```bash
node scripts/sync-shared-assets.js
```

## Adding a new shared asset

1. Put the canonical file in `assets/shared/`.
2. Add an entry to `MANIFEST` in `scripts/sync-shared-assets.js` listing the
   target `static/` directories.
3. Add the generated path(s) to `.gitignore` so the copies aren't tracked
   alongside the canonical source.
4. Add `predev`/`prebuild` hooks (`node ../../scripts/sync-shared-assets.js`) to
   any newly-consuming package that doesn't already have them.
