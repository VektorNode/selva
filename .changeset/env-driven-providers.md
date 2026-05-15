---
'@selvajs/selva': patch
'@selvajs/cli': patch
---

**Env-driven provider wiring.** New deployments no longer ship a `selva.config.js` — provider selection moved into the runtime, driven by `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env`. Provider implementations remain bundled into `@selvajs/selva`; the only operator-facing files are `.env` and `ecosystem.config.cjs`.

- `selva create` writes `.env` + `ecosystem.config.cjs` + `package.json`. The deployment `package.json` now lists only `@selvajs/cli`, `@selvajs/selva`, and `pm2`.
- `selva migrate` detects existing deployments and (a) drops the now-bundled provider packages from `package.json`, (b) backs up and deletes any stale `selva.config.js`, and (c) rewrites `ecosystem.config.cjs` if it still points at `@selvajs/runtime`.
- `selva doctor` checks for layout drift across all three of the above.
- The escape hatch for custom providers is still `SELVA_CONFIG_PATH`: set it to a `.js` file exporting a `defineConfig()` result.

Existing deployments: run `selva migrate` after updating. The CLI prints the full set of changes before applying them and saves `.bak` files for every file it touches.
