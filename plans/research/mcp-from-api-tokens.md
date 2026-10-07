# What an MCP server over `/api/v1` needs to know

**Feeds #216.** Found 2026-10-07 by driving a local Selva (`felix/api-token`, local provider) with
a real `selva_` key: list, read, edit and solve a definition, evaluate the files in
`fixtures/grasshopper/`, then create a project and upload the valid ones with metadata written from
their schemas. Everything below was observed on the wire unless marked _unverified_.

## Answer

An MCP server can be a thin client of `/api/v1` with one API token. A handful of calls cover the
whole loop: evaluate a local file, create a project, upload, describe, edit and solve. The traps are
in solving (which schema you read, how values are keyed, where option lists live, how big the
response is) and in text encoding on upload.

## Auth

- `Authorization: Bearer selva_…`, header only. A key in the query string gets 400; a key on
  `/api/admin/*` or any non-`/api/v1/` path gets 403.
- The key acts as its owner, in one org, narrowed by scopes. It sees exactly what the owner sees,
  **drafts included**. Scope narrows actions, never visibility.
- Scopes the tools need: `read` for browsing and schemas, `write` for metadata, `solve` for solving.
  `write` does **not** include `solve`. A refusal is 403 with `details.requiredScope`
  (e.g. `write:org:<id>`), which the MCP server can show the user verbatim.
- 401 means the key is invalid, expired, revoked, or its owner left the org. 503
  `API_TOKENS_UNAVAILABLE` means tokens are off on that server (Supabase until #330).
- Key management (`/orgs/{orgId}/tokens`) is session-only. The MCP server can't mint keys.
- **Check the base URL is Selva before trusting a 401.** On the dev machine another app (a host
  app on Vite's default port) answered `/api/v1/projects` with its own `401 UNAUTHORIZED`, which
  looked exactly like a rejected key. Every Selva response carries an `x-request-id` header; an
  MCP server can probe `GET /api/health` and refuse to start without it.

## Calls

| Purpose                   | Call                                                  | Notes                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List definitions          | `GET /definitions?limit=100`                          | Items: `guid`, `projectId`, `displayName`, `description`, `tags`, `status`, `solveCount`, `liveVersionId`, `updatedAt`. Paginated (`nextCursor`).                    |
| One definition            | `GET /definitions/{guid}`                             | Adds `category`, `draftVersionId`, and `liveVersion`/`draftVersion` as `{ id, versionNumber, uploadedAt, uploadedBy }`.                                              |
| Versions                  | `GET /definitions/{guid}/versions`                    | `id`, `versionNumber`, `originalFilename`, `fileExt`, `schemaExtractedAt`.                                                                                           |
| Schema, live              | `GET /definitions/{guid}/schema`                      | **Always the live version.** `?channel=draft` is ignored.                                                                                                            |
| Schema, any version       | `GET /definitions/{guid}/versions/{versionId}/schema` | Use this for the draft.                                                                                                                                              |
| Edit metadata             | `PATCH /definitions/{guid}`                           | 204. Fields: `displayName`, `description` (≤2000), `category`, `tags` (≤20, each ≤64), `coverImage`, `projectId`, `computeServerId`, `solveCacheLimit`, `status`.    |
| Create project            | `POST /projects`                                      | 201. JSON `{ name, description?, visibility = "private", autoJoinOnUpload? }`. Returns the project with its `id` and generated `slug`.                               |
| Upload definition         | `POST /definitions`                                   | 201. Multipart, see [Uploading](#uploading).                                                                                                                         |
| New version               | `POST /definitions/{guid}/versions`                   | 201. Multipart `file` + `changeNote?` (≤1000). Returns `{ version }` with its schema. Becomes the draft; live is untouched until a publish. Identical file accepted. |
| Cover image               | `POST /definitions/{guid}/image`                      | 200. Multipart field `image` (PNG accepted). Transcoded to WebP; returns `{ coverImage }` as an `/api/files/…` path.                                                 |
| One project's definitions | `GET /definitions?projectId=<id>`                     | For reading back what was just uploaded.                                                                                                                             |
| Solve                     | `POST /definitions/{guid}/solve`                      | Needs `solve`. Body below.                                                                                                                                           |

## Evaluating a file before it is uploaded

`POST /compute/schema?projectId=<id>` sends a `.gh`/`.ghx` to Compute and returns its UI schemas.
Nothing is created, so an MCP tool can tell the model what a file's inputs and outputs are before
anyone uploads it. Run against `fixtures/grasshopper/*.ghx`:

| File                             | Result                                     |
| -------------------------------- | ------------------------------------------ |
| `live_solve_showcase.ghx`        | 200 in 0.14 s: 6 inputs, 3 outputs         |
| `fixture_dynamic_value_list.ghx` | 200 in 0.20 s: 4 inputs, 3 outputs         |
| `ui_bridge_minimal.ghx`          | 200 in 0.04 s: 4 inputs, 5 outputs         |
| `sheet_metal_bracket.ghx`        | 200 in 0.15 s: 10 inputs, 4 outputs        |
| `csharp_scrip_component.ghx`     | 422 `UNPROCESSABLE`: no UI Builder in file |
| `display_pipeline_debug.ghx`     | 422 `UNPROCESSABLE`: no UI Builder in file |

- **Request:** multipart, field `file`. `projectId` is required even though nothing is stored: the
  route gates on being allowed to create a definition in that project. `computeServerId` is
  optional and pins the server, as an upload would.
- **Scope:** `write` on that project, or org-wide. A `read` or `solve` key gets 403.
- **Response:** an **array** of schemas, one per UI Builder in the file. Same shape as the
  definition schema, so the layout join below applies unchanged.
- **422 is a verdict, not a failure.** The message says what is missing (e.g. "This definition has
  no outputs defined. Add a 'Context Bake' component…"). Hand it to the model as the answer: the
  file isn't a Selva definition yet, and why.
- **503 `COMPUTE_UNAVAILABLE`** when Compute is down. Every call here needs a live Compute.
- **Size:** the upload cap (`MAX_DEFINITION_FILE_SIZE` plus 1 MB multipart overhead), checked
  before the body is read.
- **Dynamic value lists show no real options.** Their options come from a solve, and only an
  uploaded definition can be solved, so this tool reports that a list exists, not what it holds.
  `fixture_dynamic_value_list.ghx` returns three such inputs with no options at all.

Open questions for the API itself, not the MCP server:

- A mandatory `projectId` makes a plain "what is this file" check awkward. An org-level variant
  needing only org `write` would suit an MCP tool better.
- Evaluating costs Compute time but stores nothing, so `write` is arguably the wrong scope. It
  stays because the route shares the upload gate.

## Uploading

`POST /definitions`, multipart:

| Field             | Required | Notes                                                       |
| ----------------- | -------- | ----------------------------------------------------------- |
| `file`            | yes      | `.gh` or `.ghx`, same size cap as evaluation                |
| `projectId`       | no       | Falls back to a project the caller can see; always pass it  |
| `displayName`     | yes      |                                                             |
| `description`     | no       | ≤2000                                                       |
| `category`        | no       |                                                             |
| `tags`            | no       | **One comma-separated string**, not repeated fields or JSON |
| `image`           | no       | Cover image file                                            |
| `computeServerId` | no       | Pins the server used for schema extraction and later solves |

- Needs `write` and edit rights on the project.
- Compute extracts the schema **before** anything is written, so a file Compute can't read fails
  with nothing stored. Uploads took 0.04–0.1 s against a warm Compute.
- The response is `{ guid, version }`, with the full schema on `version`. Metadata (name,
  description, tags) is not echoed: read it back with `GET /definitions?projectId=`.
- A new upload gets a live v1 immediately but still reads `status: "draft"` (see below).
- **No deduplication.** Uploading a file that already exists elsewhere creates a second definition.
  The MCP tool should look for the same `displayName` with `GET /definitions` first and ask.

### Text encoding

Send every text field as UTF-8 from a file or a proper HTTP client, never as a shell argument.
`curl -F "description=…0–250…"` from Git Bash on Windows passed the en dash in the console code
page, and the server stored U+FFFD in its place ("0�20"). The upload succeeded and nothing
flagged it. The same text sent as a UTF-8 JSON file in a `PATCH` stored correctly. An MCP server in
Node or Python sends UTF-8 by default; the lesson is to **read every written field back and
compare**, which is how this was caught.

## `status` is not "has a live version"

The showcase had `status: "draft"` **and** a live v1, plus a draft v2. All three fresh uploads were
the same: live v1, `status: "draft"`. Decide the channel from `liveVersionId`/`draftVersionId`,
never from `status`.

`status` turns `published` only on an explicit publish. `POST /definitions/{guid}/publish` with
`{}` promoted the showcase's draft v2 to live, and `status` went from `draft` to `published`. It
records "someone has published this", not "a live version exists". Publishing needs `write` and
edit rights on the definition; `{ "versionId": … }` rolls live to any version, forward or back.
After publishing, `/schema` returns the new live version's schema, so a solve on `live` must use
it.

## Solving

```json
{
	"channel": "draft",
	"inputs": [/* the schema's `inputs` array, verbatim, for the version being solved */],
	"values": { "<input id>": 150, "<input id>": "rainbow" }
}
```

- `channel` is `live` (default) or `draft`; `versionId` pins an exact version (editor-only).
- `values` is keyed by **input id**, not nickname.
- **`inputs` must come from the same version you solve.** Compute matches parameters by
  `nickname`. Sending the live schema with `channel: "draft"` silently dropped two inputs whose
  nicknames changed between versions (`Get Integer` → `Sphere count`), and Grasshopper used its own
  saved values (10 spheres instead of 150). No error, no warning. The MCP tool should fetch the
  schema for the chosen version itself rather than accept one from the model.
- An input missing from `values` falls back to the schema default; one missing from `inputs` falls
  back to whatever the `.gh` file saved.
- `Idempotency-Key` is honoured on this route (per user today; per token after #329).

### Response

```
{ values: [{ ParamName, InnerTree: { "{0}": [{ type, data }] } }],
  warnings: string[],
  selva: { outcome: { diagnostics: [{ level, message, source, isGate }], blocked, aborted } } }
```

- `data` is a JSON string per item; scalars arrive as quoted strings (`"150"`). A Context Print
  output declared `type: "number"` in the schema still arrives as `System.String` (`"500.7"`):
  parse by the schema's type, not the item's.
- Two kinds of output should be stripped before handing results to a model. Detect both by item
  `type`, not `ParamName`:
  - `Selva.Schema.Models.UISchema` (`ParamName: "Schema"`): the whole UI schema embedded in the
    file, useful as a cross-check (see above).
  - `Selva.Slva.DisplayBatch`: the mesh batch for the viewer. Its `ParamName` is the Context Bake's
    nickname (`Display` in the showcase, `Model` in the bracket). It is not listed in
    `schema.outputs`. **~330 KB at 10 spheres, ~4.9 MB at 150, ~450 KB for the bracket.**
- File outputs (`Selva.FileIO.FileData`) carry the file inline:
  `{ id, fileName, fileType, isBase64Encoded, data, subFolder, metadata }`. `fileName` has no
  extension (`bracket_flat_pattern` + `fileType: ".dxf"`). Decode `data` and save to disk rather
  than passing base64 to the model.
- `selva.outcome` is the clean summary: `diagnostics` (levels seen: `remark`, `warning`,
  `error`), `blocked` (a gate error stopped the solve), `aborted`. `warnings` is the raw Compute
  text and duplicates it.
- Identical inputs return in ~5 ms (cached); a fresh solve here took 0.7–1.2 s.

## Where input options live

`schema.inputs[]` carries `id`, `nickname`, `paramType`, `default`, `description`,
`inputStructure`, and **no option lists or ranges**. Those are in the layout:

```
schema.layout.tabs[].groups[].items[]   // { type: "input", paramId, displayName, widgetType, config }
  config.minimum / maximum / stepSize   // sliders
  config.options                        // valueList: { label: value }
  config.defaultOptions                 // dynamicValueList, before any solve
```

Join on `items[].paramId === inputs[].id`. Prefer `displayName` from the layout for anything a
person reads; `nickname` is the Grasshopper wire name.

Showcase example (draft v2):

| Input              | paramType        | Options / range                                        | Default |
| ------------------ | ---------------- | ------------------------------------------------------ | ------- |
| Sphere count       | integer          | 0–250, step 1                                          | 60      |
| Radius scale       | number           | —                                                      | 1       |
| Mode               | valueList        | `Spheres`, `Voronoi cells`                             | Spheres |
| Palette            | dynamicValueList | `warm`, `cool`, `mono` (+ `rainbow` above 100 spheres) | warm    |
| Stage delay (s)    | number           | 0–3, step 0.1                                          | 0       |
| Incidental message | valueList        | `none`, `warning`, `error`, `exception`                | none    |

Option **values** can differ from what a person would guess (`Voronoi cells`, not `Voronoi`).
Send the value, not the label.

## Dynamic value lists

The real option list only exists after a solve. A solve returns an output whose item is:

```json
{ "targetInputId": "<input id>", "options": { "Warm": "warm", "Rainbow": "rainbow" } }
```

`targetInputId` names the input it refills. Options depend on the other inputs (Rainbow appeared
only at >100 spheres), so a tool offering choices for a dynamic list should solve first with the
other values set, read this output, then solve again with the pick. Detect these outputs by the
item `type` (`…DynamicValueListGoo`) or by `targetInputId`, not by name.

## The workflow we ran

The session behind this note, as the sequence an agent should follow:

1. **Confirm the server.** Probe the base URL; the first attempt hit the wrong app (see Auth).
2. **Explore what exists.** `GET /definitions`, then one definition and its versions. This is where
   the live/draft split and the misleading `status` showed up.
3. **Edit metadata.** A no-op `PATCH` (the current description written back) proved `write`
   without changing anything; then a real `PATCH` with a description, category and tags.
4. **Solve.** Defaults first, then real values. The first real solve silently ignored two inputs
   because the schema came from the live version while the solve ran the draft. Fetching the
   matching version's schema fixed it. A second solve picked an option (`rainbow`) that only the
   first solve's dynamic-list output revealed.
5. **Evaluate local files.** `POST /compute/schema` on each fixture: three returned schemas, two
   returned a 422 explaining why they aren't Selva definitions. While Compute was down every call
   was 503. Reading the schema straight out of the `.ghx` XML works, but it bypasses the API, so
   it is no substitute when the API is what's being exercised.
6. **Create a project and upload.** `POST /projects` ("AI Uploads"), then one `POST /definitions`
   per valid file, with name, description, category and tags written from that file's evaluated
   schema: what it does, each input with its range or options, each output.
7. **Read back and correct.** Listing the project confirmed all three; reading the descriptions
   back showed the encoding damage, fixed with a UTF-8 `PATCH`.

What an agent can write on its own from a schema, and what it can't:

- **Can:** the input list with ranges, defaults and option values; which outputs refill which
  dynamic lists; a sensible name when the schema still has the default "New Schema"; tags from the
  input kinds and the schema's own description.
- **Can't:** what a dynamic list will offer before a solve, or behaviour the schema doesn't state
  (e.g. what "convergent" means in the dynamic-list fixture). Say less rather than guess.

## Authoring a definition from scratch

The second run started with no file: build a sheet-metal bracket in Grasshopper through the Rhino
MCP, wire it for Selva, save it, then evaluate, upload and solve it through the API. Result:
`sheet_metal_bracket.ghx`, 45 objects, built with the SheepMetal plugin.

1. **Build the geometry.** Polyline To Sheet → Unroller → Reroll (cut the holes) → Manifold To
   Sheet → Sheet Properties → Unroller + Sheet Info, plus three small C# scripts for the profile,
   the hole layout and the stats.
2. **Wire the Selva I/O.** One `Get *` param per input, nicknamed as the UI should show it, with a
   slider or Value List as its source for the local default. One Context Bake or Context Print per
   output, named on its input param. Display → Combine Display → one `Model` bake for the viewer.
3. **Graft the schema** built from the live `InstanceGuid`s, validated twice: the JSON Schema
   before grafting, the plugin's `SchemaValidator` after.
4. **Save with Enable off**, then reload the archive to prove the schema survived.
5. **Evaluate, upload, read back, solve** through the API, as in the first run.

Traps that cost a round each:

- `SetPersistentData` **appends** to a component's default. Unroller's `Orient` held two values,
  every downstream component ran twice, and Reroll failed to map cuts onto the wrong unroll. Clear
  `PersistentData` first.
- Geometry To File wants the ending with its dot (`.dxf`); `dxf` silently falls back to `.3dm`.
- **Evaluation doesn't prove the server can solve it.** `/compute/schema` reads the embedded schema
  without solving, so a missing third-party plugin on Compute only shows up at the first solve.
  Here Compute had SheepMetal, and a solve took 3.3 s.
- **Local and server runs can disagree.** Value List items written as quoted expressions
  (`"\"Steel\""`) handed SheepMetal the material `"Steel"` with the quotes, but only locally. On
  Compute the value comes from the schema, so server solves looked right. Check the local canvas
  values as well as a server solve.
- **Editing the canvas can rewrite the authored schema.** Changing the Value List made the bridge
  re-sync `Material` from Grasshopper and blank the description written into the schema. Setting
  the Get param's own `Description` was not picked up. Re-read the schema after any canvas edit,
  restore what was lost, and only then save.
- Geometry To File writes DXF holes as `SPLINE` entities, not `CIRCLE`. The file is valid, but
  some laser CAM software handles circles better.
- The Rhino MCP's `g1_apply_graph` and `g1_connect` don't work; everything went through
  `run_csharp`. Its `get_viewport_image` returned 240 K characters, too large for a tool result:
  capture to a PNG on disk from `run_csharp` and read the file instead. Rhino-side recipes (C#
  Script params, plugin discovery, capture) are in `.claude/skills/rhino-mcp/`.
- When the user names a domain plugin (here, "sheet metal" means SheepMetal), list its components
  by filtering the component server on category first. The tool's name search matches
  descriptions and misses most of them.

The Selva-specific half of this (steps 2–4) is mechanical and fails silently when done wrong (see
[plugin-context.md](../../docs/contributing/plugin-context.md)). It's the strongest candidate for a
tool of its own, on the Rhino side rather than in this API: `wire_selva_io(inputs, outputs)` that
places the params and bakes, grafts a validated schema and saves the file.

### Publishing it with a real cover

Order: fix → save → `POST …/versions` → `POST …/publish` → `POST …/image`. The cover belongs to
the definition, not a version: it stayed through the v3 publish. The bracket went through three
versions in one session (overlap fix, value-list fix), so `upload_version` + `publish_definition`
is the normal loop, not an edge case.

- **Look at the geometry before publishing.** Every number was right (weight, flat size, hole
  count), but the cover render showed the flat pattern overlapping the base flange: the part
  extruded the other way from what the stats script assumed. Only the picture caught it. Making the
  cover is the visual check, so it belongs **before** publish.
- **Render the cover from the real geometry** when the Rhino MCP is there: bake the solid and the
  flat to temporary layers, capture the viewport, crop to the content, then delete the bake. That
  beats a drawn SVG.
  - `ViewCapture.CaptureToBitmap(ViewCaptureSettings)` returned a blank image.
  - `view.CaptureToBitmap(size)` works, but once the size is well past the viewport (2400 px on a
    1244 px viewport) it ignores the display mode and draws the grid. 1600 px was clean.
- **Toggling Enable off and on in one script call left the bridge `Offline`.** Toggle in separate
  solves and check that the bridge message reads `Ready` before you report a URL.
- Cross-check numbers that should scale: the same bracket weighed 500.7 g in copper and 150.9 g in
  aluminium, exactly the density ratio.

## Making the authoring loop reliable and fast

Every failure in the bracket run was silent (a doubled branch, an overlap, a quoted value, a
wiped description), and most of the time went on about 40 Rhino round trips, not on solving.

**Checks the loop is missing**, cheapest first:

1. **Canvas check:** no component errors or warnings, and every output exactly one branch with one
   item. That alone catches the doubled `Orient`.
2. **Edge sweep on the server:** each input at its minimum and maximum with the rest at defaults,
   every option, and a few hostile combinations (thick sheet with a tight radius, short flanges
   with a big radius, max holes on min width). Assert on the outputs, not just HTTP 200: weight
   above 0, display present, DXF entities, expected bend and hole counts. Probe Compute first and
   stop on the first 503: the first sweep sent 30 requests to a stopped Compute.
   - **A failed solve is HTTP 200.** The bracket's one failure came back 200 with a single
     `error` diagnostic from the plugin, followed by about 12 cascade warnings ("failed to collect
     data"). Judge a solve by `selva.outcome`, and show the model the first `error`, not the
     cascade.
   - **Varying one input at a time misses interactions.** The sweep passed short flanges at the
     default angle; a grid over the inputs that interact found a much larger failing region. Let
     the tool take groups of inputs to sweep pairwise.
   - Cost: 30 solves at a median 1.3 s; repeated inputs came back from cache in 10–50 ms.
3. **Local vs server comparison:** same inputs, compare text outputs.
4. **A picture before publish:** the cover render is the only check that caught the overlap.

**Reliability fixes that belong in Selva, not in an agent:**

- **The plugin derives the schema itself:** range and default from the upstream slider, options
  from the Value List, description from the Grasshopper param. No hand-written schema JSON, so
  nothing for a re-sync to wipe.
- **Record plugin dependencies.** The `.ghx` lists the libraries it references; Selva could read
  them at upload and check Compute has them, instead of failing at the first solve.
- **Flag breaking versions.** Diff the inputs against live on `POST …/versions`: a renamed nickname
  silently stops matching saved values and API clients.

**Speed fixes in the tooling:**

- **Build from a declarative graph spec** (components, wires and values as JSON; values replace,
  never append) in one call that returns per-component messages and data counts. This replaces the
  10 KB inline C# and the broken `g1_apply_graph`.
- **`wire_selva_io(spec)`:** Get params with sliders, bakes and prints, schema, save with Enable
  off. One call instead of steps 2–4.
- **`ship_version`:** evaluate, upload a version, check it solves on the server, diff against live,
  publish, set the cover. The bracket went through three versions; each took about 8 calls by hand.
- **Covers from the server's display output**, rendered headless in the Selva viewer: no Rhino
  capture quirks, and the cover matches what users see.
- **Cache the component catalog** per plugin version instead of rediscovering it each session.

## Suggested tools

| Tool                         | Calls                                                                                                                                      | Scope |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `evaluate_definition_file`   | `POST /compute/schema` with a local file; inputs/outputs flattened as in `describe_definition`, or the 422 reason                          | write |
| `create_project`             | `POST /projects`                                                                                                                           | write |
| `upload_definition`          | `POST /definitions`, after `evaluate_definition_file` passes and a duplicate check; reads every field back                                 | write |
| `list_definitions`           | `GET /definitions`                                                                                                                         | read  |
| `describe_definition`        | `GET /definitions/{guid}` + the chosen version's schema, flattened to one row per input with options from the layout                       | read  |
| `update_definition_metadata` | `PATCH /definitions/{guid}`                                                                                                                | write |
| `solve_definition`           | `POST …/solve`, schema fetched internally, schema and display items stripped by type, file outputs saved to disk, `selva.outcome` surfaced | solve |
| `upload_version`             | `POST …/versions`; diffs the new schema's inputs/outputs against live and reports it                                                       | write |
| `set_cover_image`            | `POST …/image`; a viewport capture of the solved geometry when Rhino is reachable, else an SVG of the I/O                                  | write |
| `publish_definition`         | `POST /definitions/{guid}/publish`; shows the draft-vs-live diff in inputs first                                                           | write |
| `dynamic_options`            | one solve, return each `targetInputId` → options                                                                                           | solve |
| `edge_sweep`                 | min/max/options solves with output assertions; probes Compute first and stops on 503                                                       | solve |
| `check_solvable`             | one solve with defaults right after upload; reports missing plugins that evaluation can't see                                              | solve |

## Not covered here

- Share links and project membership: not exercised.
- Rate limits (#214) and token idempotency namespacing (#329) aren't built yet.
- Whether a `Display` payload can be requested smaller, or skipped, server-side: _unverified_, and
  probably worth an option on the solve route before an MCP server ships.
