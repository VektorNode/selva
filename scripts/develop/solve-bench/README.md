# Solve bench

Measures where a solve's time goes, from Grasshopper to the first frame in the browser. Why and
what it decides: [solve-transport-bench](../../../plans/research/solve-transport-bench.md).

Run from the repo root, against `dev:local` with sharing on (the share-link baseline needs it):

```bash
SELVA_FLAG_ENABLE_SHARING=true SELVA_FLAG_COMPUTE_DEBUG=on pnpm dev:local
node scripts/develop/solve-bench/capture.mjs                    # proxy :6600 → compute :6500
node scripts/develop/solve-bench/run.mjs setup --compute http://localhost:6600
node scripts/develop/solve-bench/run.mjs alternate --profile facade
node scripts/develop/solve-bench/browser.mjs --profile facade --input "Largest hole"
```

Everything lands in `out/`, which is gitignored: rows hold input values, and `state.json` holds
session cookies. The routing column needs compute logging at Debug (`RHINO_COMPUTE_LOG_LEVEL=Debug`,
or a Debug build); the runner reads `%TEMP%\Compute\Logs`.

## capture.mjs

A proxy between Selva and compute. Point Selva's compute server at it (`run.mjs --compute`, or
`/admin/compute`) and every solve becomes a row in `out/capture.jsonl`, plus a readable
`out/capture.log`: the inputs as sent, the user and definition, compute's `Server-Timing` (gh,
harvest, encode, recomputed), bytes per output and per branch, and empty outputs.

`dedupe` is what a whole-item dedupe would have skipped: bytes of items over 4 KB whose hash was
in the same session's previous two responses. It works on any definition, so clicking through a
real project with capture on measures that project.

## run.mjs

Seeds what it needs on first use: the admin (sign-in, else `/setup`), `member` and `member2` by
invite, a "Solve bench" project, the profile's definition (uploaded again only when the file
changes) and a share link. Pass `--password` for a store seeded with a different one.

| Scenario    | Does                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| `setup`     | Seeding only. `--compute <url>` also points Selva at that compute server    |
| `inputs`    | One user changes each input in `classes` on its own, `--rounds` times each  |
| `sweep`     | Steps the `sweep` input through its values and times a cheap change at each |
| `alternate` | Two users take turns, signed in, then as share-link visitors (no header)    |
| `crowd`     | Three users round-robin, for more users than compute has children           |
| `idle`      | Solves, waits `--idle-minutes` (10), solves again: do outputs come back?    |

Each step picks a new random value in the profile's range, so neither Selva's result cache nor
compute's answers. A solve either one does answer counts under `cached` and stays out of the
medians.

Summary columns, all medians: `ms` is the request at the client, download included; `selva solve`
Selva's round trip to compute; `gzip` Selva compressing the reply; `gh` Grasshopper; `recomputed`
the share of objects that ran; `MB` the reply decoded; `empty` solves with an empty output;
`routing` compute's outcome per signed-in solve.

## browser.mjs

Opens the definition in Chrome as a signed-in user, changes one input `--steps` times, and splits
each change into: form to request, server, download, parse and apply, and draw.

Nothing in the app marks "this solve's scene is on screen", so the page is probed from outside.
"Applied" is the first of: the solve-status pill leaving its solving state, the canvas's mesh
count changing, or a frame uploading geometry to the GPU. "Draw" is the first draw call of that
frame, not the moment it reaches the screen. A result that changes nothing visible reports
`none`. Number, boolean and colour inputs only.

A precise signal needs one attribute in the app: `data-scene-version={sceneVersion}` on the viewer
canvas in `Viewer.svelte`, which bumps `sceneVersion` right after `updateScene`.

## Profiles

`profiles.mjs` says what each definition's inputs may be set to: `base` values, `perUser`
overrides (users whose documents differ, so a cold solve pays), `inputs` ranges, the `vary` input
a turn changes, the `classes` the inputs scenario walks, and the `sweep`. `--profile` takes a name
or a JSON file of the same shape.
