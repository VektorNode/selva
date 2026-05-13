# @selvajs/runtime

Self-contained, prebuilt Selva compute-app. This is the artifact deployed onto a server — install it, point it at a `selva.config.js`, run.

## Layout after `pnpm run build`

```
packages/runtime/
├── build/                       Prebuilt SvelteKit (adapter-node) output.
│   ├── index.js                 Entry point. `node build/index.js` to start.
│   ├── client/
│   ├── server/
│   └── handler.js
├── templates/
│   ├── selva.config.example.js  Operator-editable config, compiled from
│   │                            the repo's selva.config.ts.
│   └── ecosystem.config.cjs     PM2 process file with cwd-relative paths.
└── package.json                 Flattened, with runtime deps pinned to
                                 real versions (no workspace:* / catalog:).
```

## Operator install shape

```
my-deployment/
├── package.json              # depends on @selvajs/runtime
├── selva.config.js           # operator's copy of selva.config.example.js
├── .env                      # secrets (see compute-app/.env.example)
├── ecosystem.config.cjs      # copied from runtime/templates/
└── node_modules/
    └── @selvajs/runtime/
        ├── build/
        └── templates/
```

Start:

```bash
SELVA_CONFIG_PATH=./selva.config.js node node_modules/@selvajs/runtime/build --env-file=.env
```

Or under PM2:

```bash
pm2 start ecosystem.config.cjs
```

## How the runtime finds the config

`providers.server.ts` reads `SELVA_CONFIG_PATH` at module load:

- Unset → uses the config bundled into the build at compile time (dev workflow).
- Set → dynamic-imports the file at the given path (`.js` only — there is no TS compiler at runtime).

The build script compiles the repo's `selva.config.ts` into `templates/selva.config.example.js` so operators have a working starting point to copy + edit.

## Building

```bash
pnpm --filter @selvajs/runtime run build
```

That runs `scripts/build.js`, which:

1. Builds `@selvajs/compute-app` with `ADAPTER=node`.
2. Copies `packages/compute-app/build/` into `packages/runtime/build/`.
3. Compiles `selva.config.ts` → `templates/selva.config.example.js` via esbuild.
4. Writes `templates/ecosystem.config.cjs` from a template.
5. Generates a flattened runtime `package.json` (next to the existing one is preserved as `package.source.json`) by resolving every `dependencies` entry of compute-app, platform, and providers, replacing `workspace:*` with concrete versions and `catalog:` with values from `pnpm-workspace.yaml`.

The flattened `package.json` is what gets published.

## Publishing

```bash
cd packages/runtime
npm pack          # inspect the tarball first
npm publish       # publishConfig.access = "public" is set
```

Provider packages (`@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`) must be published first — they're listed as real (non-workspace) deps in the flattened `package.json`.
