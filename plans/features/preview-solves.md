# Preview solves: files are made when someone downloads them

**Built, not yet verified live.** Spans the compute fork, the plugin, `@selvajs/compute`,
`@selvajs/solve`, Selva's API and `@selvajs/ui`. Generalises parafa's preview mode (its ADR-0048)
so parafa can drop its own.

## Why

Every solve makes every output, so a definition that exports files pays for them on every edit,
though nobody downloads after most edits. On the [transport bench](../research/solve-transport-bench.md),
turning the 3DM export on took Grasshopper from 1.3 s to 10.1 s, the edit from about 2 s to 22.8 s,
and the reply to 208 MB. Parafa hit the same wall (12–15 s per edit on a 25-piece job) and built a
preview mode into its own `host-context` input.

## What people see

- **Someone using the form.** Everything shown in the page (3D view, numbers, text, charts, images)
  updates on every edit, as today. A Download button says the file is made when they click. The
  click solves once with the inputs on screen, counts the seconds, then downloads. Every other
  Download button is then ready at once, until an input changes.
- **The author.** Turns on **Make files on download** in the builder's Behaviour settings
  (`previewSolves` in the UI schema, off when absent, so every existing definition behaves as
  today). Selva's file components that feed only Download buttons then skip in a preview by
  themselves. Production-only work above them (an unroll, a nesting) still runs unless
  the author gates it with the new **Solve Mode** component: its `Preview` output is true in a
  preview, for a Stream Filter or a component's own on/off input. At the canvas every solve is
  full, so files appear as they do today.
- **An API caller.** Unchanged: a solve without `mode` is full.

## The rule

Every solve is `preview` or `full`, and absent means full. Every part that predates this (compute
server, plugin, client, API script) therefore behaves as today, and the parts ship in any order.

The caller picks the mode, and the definition decides whether a preview means anything: the plugin
treats a solve as a preview only when the request says `preview` and the embedded schema has
`previewSolves` on. A preview must solve the same inputs to the same model as a full solve; only
what the page doesn't show may differ.

## Design

### 1. Compute fork: carry the mode

The request body gains `selvamode: "preview"`. `ResthopperEndpoints` defines a `SelvaMode` document
constant on every request, empty when absent, beside `SelvaEventUrl` and the others, so a reused
document never keeps the previous request's mode. Compute's result cache keys on the request body,
so the two modes never share an entry. Upstream compute and older fork builds ignore the field.

### 2. Plugin: skip download-only files

`DocumentSolveRuntime` reads `SelvaMode` at `SolutionStart`. Each deferred file component and each
Solve Mode component remembers the mode it last ran in, and any whose mode differs from this solve's
is expired, so Grasshopper reruns it and what sits below it. Tracking it per component, not per
document, means a solve that aborted, or a `cachesolve` hit that never reached Grasshopper, can't
leave a component holding the other mode's result. With unchanged inputs on a warm document that is
all that runs, so the download after a preview costs the export alone, as long as session affinity
sends both to the same child.

Which file components defer comes from the schema embedded in the document (the UIBuilder component
outputs it headless too). The walk goes **downstream**, from each `ISelvaFileOutput`:

- Follow every recipient of its outputs through wires, relays and pass-through params.
- It defers only if every path ends at a Context Bake whose output the layout shows as a Download
  button (widget `file`).
- Any other recipient (an image widget's bake, a component reading the file's size or name, a Merge,
  another file component) or no recipient at all means it is made every solve.

Walking upstream from the Download bakes is not enough: it can't see a second recipient, such as a
component that turns the file's byte count into a text output, which would go blank.

Every miss errs toward making the file, as today, so nothing goes missing from the page. A headless
document's wiring never changes, so the set is built once per document, at its first preview. A
local document never runs a preview, so it never builds the set.

A deferred component outputs nothing in a preview and adds no runtime message. Its Context Bake is
Grasshopper's own and will warn "failed to collect data", so `SolveDiagnosticsCollector` drops that
warning from bakes fed only by deferred components. Otherwise every preview's verdict would read
warning. The plugin lists the output ids it deferred in `SelvaOutcome`, so the UI knows which
outputs were deferred and doesn't have to guess from which ones are empty.

A file component that can't defer carries a canvas remark (not a warning, which would reach the
verdict) saying why, so the author sees why an edit is slow.

Solve Mode is a new component in Selva › Utilities with one output, `Preview`. Environment keeps
its param list. Rhino 8 and 9.

### 3. Server and packages

- `@selvajs/compute`: `SolveOptions.mode` and the scheduler's, sent as `selvamode` only for
  `preview`. The mode is part of the scheduler's response-cache key, which today hashes only the
  definition and data tree; without it, a download with the preview's inputs gets the cached
  preview back, with no files.
- `@selvajs/solve`: `SolveEngineSolveArgs.mode`, part of the single-flight key, so a download never
  joins a preview's flight.
- Selva: `SolveBodySchema` gains `mode: 'preview' | 'full'`, default `full`, passed through
  `runSolve` for stored definitions, share links and remote URLs alike. For a signed-in user both
  modes carry the same session id, so the download lands on the warm document. Share links and
  remote URLs get no session id (`solveSessionId`), so their download is a cold full solve: one
  solve at today's per-edit cost, paid once instead of on every edit. A download solve counts
  against the rate limiter like any other: it is real compute.

### 4. UI

The solve session sends `mode: 'preview'` on the solves it runs for input changes. The download is a
separate one-shot request, not a session solve: reported through the session it would replace the
scene with identical geometry and push a 200 MB result into the client memo.

The session owns one **file set** per shown result, keyed to the values that result was solved
with (`SolveResult.values`), never the form's live values: the download must solve exactly what is
on screen, or `SetInputs` sees changed inputs and the warm document reruns everything.

| State     | Shown on every deferred Download button              | Leaves on                                                         |
| --------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `waiting` | Download, "Made when you download"                   | click → `making`                                                  |
| `making`  | Indeterminate bar, elapsed seconds, Cancel           | result → `ready` or `empty`; error → `failed`; cancel → `waiting` |
| `ready`   | Download, the file size                              | click downloads at once                                           |
| `empty`   | "Nothing to download for these inputs"               |                                                                   |
| `failed`  | The full solve's errors and gate messages, Try again | click → `making`                                                  |

- No deferred ids, no new UI. A definition without Download buttons, or whose files all feed
  something on the page, looks exactly as today. The page still sends `preview`, since Solve Mode
  gated work may skip, but nothing about downloads appears.
- Any input change drops the file set, aborting a `making` solve, and the next preview starts a
  new one in `waiting`.
- One full solve serves every Download button: a click on a second button while `making` joins
  it, and `ready` holds all its file outputs.
- Download is disabled while a preview is in flight: the result it would make files for is about
  to be replaced.
- The download solve carries no live-event stream, so it shows no Report Progress steps: the
  tab's stream belongs to the session's solve, whose progress state it would overwrite. Steps
  need the stream to tell two solves apart first.
- `failed` matters more than it looks: work gated behind Solve Mode (a nesting, an unroll) only
  runs in the full solve, so its errors first appear on download. Show them at the button, with the
  same rendering as a preview's messages.
- `too_large` on a download says the files exceed the server's reply limit, not "solve failed".
- A file output not in the deferred list behaves as today: one that arrived downloads directly (an
  older plugin or compute ignored the mode), and an empty one has nothing to download.
- The full solve's display outputs are dropped; the scene keeps the preview's.
- The client memo (`solve-memo.ts`) holds previews only. Scrubbing a slider back to earlier values
  serves the memoized preview, whose file set starts in `waiting` again.

### 5. Local

The plugin-ui bridge sends no mode, so local solves stay full. The plugin side is the same code, so
the bridge can set the constant later if local exports turn out slow.

## Parafa

Parafa's preview is this, built for one plugin. To move over:

- vektor-fab's Profile Job reads the `SelvaMode` constant, a public contract like `SelvaSolveId`,
  and falls back to `host-context.mode` until parafa ships.
- Parafa's `/api/compute` passes `mode: 'preview'` to the solve engine instead of writing it into
  `host-context`; server solves (Freigeben, batch, API) pass nothing. `SolveMode` and the `mode`
  key leave `hostContext.ts`.
- The door rule from ADR-0048 stays parafa's: Selva carries the mode, the host decides it.

## Rejected

- **Defer every file component in a preview.** Inline drawings (Render SVG into an image widget)
  are file outputs too and would go blank.
- **Decide by format**: make what a browser can show, defer the rest. A downloadable SVG for a laser
  cutter is then made every solve, and the author can't see the rule.
- **A per-component "make in preview" toggle.** The author has to know it exists, and a wrong
  default blanks an output silently.
- **Selva's server sends the ids to defer.** The .gh already holds the schema; a second copy of the
  rule can drift from it.
- **Start the full solve after every preview.** Doubles compute per edit to hide a wait people only
  meet when they download. Revisit, as a full solve after a few idle seconds, if that wait becomes
  the complaint.
- **Return only the file outputs from the download solve.** Saves one preview-sized payload per
  download. Not worth an API field until measured.
- **Serve files by URL instead of inline base64** ([cloud-binary-transport](./cloud-binary-transport.md)).
  Makes a 200 MB reply cheaper but doesn't avoid making it. Independent of this.

## Failure cases

What can go wrong, and what in the design stops it. "Slow" means correct but cold; "blank" means
something missing from the page, which the design must never allow.

| Case                                                                    | Without care                    | Handled by                                                       |
| ----------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| File component also feeds a size or name readout                        | Blank text                      | Downstream walk: any non-Download recipient makes it every solve |
| SVG shown inline and offered for download                               | Blank drawing                   | Same: the image widget's bake is a non-Download recipient        |
| Preview aborted, or answered from `cachesolve`, then download           | Empty files                     | Per-component last-run mode, not per-document                    |
| Any cache keyed on inputs alone (scheduler, single-flight, client memo) | Download served the preview     | Mode in every key; the download bypasses the memo                |
| Download solves the form's live values, not the shown ones              | Slow, or files for other inputs | File set keyed to `SolveResult.values`                           |
| Share link or remote URL, no session id                                 | Slow                            | Accepted: one cold full solve per download, not per edit         |
| No `SELVA_HMAC_KEY`, so no session ids at all                           | Slow                            | Same                                                             |
| Empty Context Bake warns "failed to collect data"                       | Every preview reads warning     | Collector drops it for deferred bakes                            |
| Error only raised by Solve Mode gated work                              | Form looks fine, download fails | `failed` state shows the full solve's messages at the button     |
| Author gates something the page shows behind Solve Mode                 | Preview and download disagree   | Not enforceable; docs say gate only what files use               |
| Download reply over the server's size limit                             | Generic failure                 | `too_large` names the limit                                      |
| Old compute or plugin ignores the mode                                  | Files arrive in the preview     | No deferred ids; UI downloads directly as today                  |
| Definition with no UIBuilder schema                                     | Nothing to defer                | Every solve full, as today                                       |

## Implementation

Each step is harmless until a caller sends `preview`, so they land in order and ship apart.

1. **Compute fork** (`compute.rhino3d`). `selvamode` on `Schema`; `ResthopperEndpoints` defines
   `SelvaMode` beside `SelvaOutcome`, empty when absent. Test: a body with and without the field
   sets and clears the constant on a reused definition.
2. **Plugin, Rhino-free part.** The deferral rule as a pure function over a small graph POCO (file
   components, recipients, bake to widget map), linked into `Selva.Tests` like the other extracted
   helpers. Fixture cases: one per row of the failure table that involves wiring.
3. **Plugin, GH part.** Build the graph POCO from the document; `DocumentSolveRuntime` reads the
   constant, expires by per-component mode, and writes deferred ids into `SelvaOutcome`; deferred
   components short-circuit `SolveInstance`; the collector drops their bakes' warning; the canvas
   remark; Solve Mode component (new GUID, Selva › Utilities, icon). Add `deferred` to the outcome
   in `wire-schema.json` and run `pnpm generate`. Verify live in Rhino 9 and 8 through compute.
4. **`@selvajs/compute`.** `mode` on `SolveOptions` and the scheduler, sent only for `preview`, in
   the response-cache key. Test: same tree, two modes, two cache entries.
5. **`@selvajs/solve` and Selva's API.** `SolveEngineSolveArgs.mode` into the single-flight key;
   `SolveBodySchema.mode`; `runSolve` passes it through; the outcome's deferred ids reach
   `SolveResult`. Test: a preview and a full solve with the same values never coalesce.
6. **UI.** Preview mode on session solves; the file-set state machine in `@selvajs/solve/client`
   (framework-free, so it can be tested without Svelte); `OutputDisplay.svelte` renders its states.
   Test the state machine's transitions, including abort on input change and join on a second click.
7. **Measure.** The bench's Files scenario: a preview with Files on should cost what Files off costs
   today, and the download about the export alone on a warm child.

The cheap download relies on [compute sessions](./compute-sessions.md): session affinity, and
`SetInputs` skipping unchanged inputs so a warm document reruns only the expired file components.

## Open questions

- Should solve metrics record the mode, so download solves can be told apart from edits?
- Share links download cold. If that wait becomes the complaint, they need a session id that a
  browser still can't use to mint claims, for example one derived from the share link and
  definition, shared by every visitor of that link.
