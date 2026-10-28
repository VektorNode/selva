# Local bridge performance and reliability audit (Rhino 9)

Measured 2026-10-28 against a live Rhino 9.0.26293 (.NET 10.0.14), Selva 0.24.0-beta.1 from the yak
package, GH1 canvas, `fixtures/grasshopper/live_solve_showcase.ghx`, Rhino panel session. Three
passes: live timing and stress runs driven from outside Rhino, an offline benchmark of the client
decoder on captured frames, and a read-only review of the bridge's hot paths.

Confidence tags: **measured** (seen live or benchmarked), **code** (the whole path is visible in
code, not triggered), **plausible** (mechanism visible, trigger not reproduced).

## How it was measured

- **External driver.** [`bridge-drive.mjs`](../../.claude/skills/rhino-mcp/bridge-drive.mjs) takes the
  UI Bridge's URL output, sends the page's `Origin` and the fragment secret, then scripted
  `valueUpdate` / `cancelSolve` frames, and logs every frame with ms since the last send. Driving from
  outside matters: any `run_csharp` call runs on Rhino's UI thread and releases whatever was queued.
- **In-Rhino solve window.** A `SolutionStart`/`SolutionEnd` handler subscribed after Selva's own,
  so its window includes Selva's broadcast. It logs per-component `ProcessorTime`.
- **Client decode.** The real `@selvajs/visualization` parser run in Node on two captured frames,
  with the assembly worker shimmed by `worker_threads`.
- **`SELVA_PERF_LOG` was off.** It is read once per process, so `BridgePerf`/`DisplayPerf`
  breakdowns (collect vs send ms) were unavailable. Set it before starting Rhino for the next pass.
- The client benchmark ran on the same machine during part of the live runs, so some live round
  trips may read high. Ratios between runs in the same block are reliable.

## Baseline

| Scenario                                     | valueUpdate → solveStarted | Round trip | Payload |
| -------------------------------------------- | -------------------------- | ---------- | ------- |
| Voronoi, 100 cells                           | 38 ms                      | 281 ms     | 43 KB   |
| Spheres, 121                                 | 35 ms                      | 337 ms     | 3.9 MB  |
| Spheres, 180                                 | 36 ms                      | 757 ms     | 5.75 MB |
| Switch back to Voronoi (cached)              | 38 ms                      | 77 ms      | 83 KB   |
| 250 spheres (blocked by the "Too many" gate) | 37 ms                      | 649 ms     | 0       |

The 35 ms before every solve is `PanelScheduleSolutionDelayMs`: deliberate, so "Solving…" paints
before the solver takes the UI thread the WebView shares.

## 1. Meshing density dominates the whole pipeline (measured)

`GH_WebDisplay` fell back to `MeshingParameters.FastRenderMesh` when nothing is wired to Meshing
Settings. On Rhino 9 one sphere meshes to:

| Parameters          | Vertices | Faces  | Time   |
| ------------------- | -------- | ------ | ------ |
| `FastRenderMesh`    | 9,895    | 10,352 | 6.6 ms |
| `Coarse`            | 9,895    | 10,352 | 6.2 ms |
| `QualityRenderMesh` | 8,383    | 8,192  | 5.7 ms |
| `Default`           | 559      | 512    | 0.4 ms |

`FastRenderMesh` has `RefineAngle = 0`, `Tolerance = 0`, `RelativeTolerance = 0.65`,
`GridMinCount = 16`. The cost carries through every later stage:

| Spheres mode, Display meshing | n   | Display ms | Round trip | Wire          | Client decode (warm) | GPU memory |
| ----------------------------- | --- | ---------- | ---------- | ------------- | -------------------- | ---------- |
| Unwired `FastRenderMesh`      | 150 | 730–780    | 780–820 ms | 4.8 MB        | 560 ms               | 65.9 MB    |
| Unwired `FastRenderMesh`      | 199 | 800–860    | 840–910 ms | 6.3 MB        |                      |            |
| `MeshingParameters.Default`   | 150 | 79–85      | 120–127 ms | 140 KB        | 27 ms                | 3.75 MB    |
| `MeshingParameters.Default`   | 199 | 86         | 130 ms     | 180 KB        |                      |            |
| `new MeshingParameters(0.5)`  | 199 |            | 212 ms     | 4.6 KB/sphere |                      |            |
| `new MeshingParameters(0.0)`  | 199 |            | 71 ms      | 0.2 KB/sphere |                      |            |

Round trips are for the Display-dominated runs; a count change also reruns the fixture's Voronoi 3D
(see 3.5), which puts it at ~400 ms either way. A radius-only change with `Default` round-trips in
70 ms. After a sweep, `MeshItemCache` held 24 MB in 398 entries, against 423 MB in 1,431 before.

**Decision:** the fallback is now `MeshingParameters.Default`. Not compared on Rhino 8, so it is
unknown whether `FastRenderMesh` was always this dense or Rhino 9 changed the preset; either way
`Default` is the cheaper, still smooth choice, and a wired Meshing Settings value restores any density.

## 2. Reliability

### 2.1 Out-of-range values are applied as sent (measured)

`ValueApplicator` rejects only non-numbers, NaN/Infinity and int overflow. It never checks the
schema's min/max. A `valueUpdate` with sphere count 9999 (schema max 250) froze Rhino for over 70 s
with private bytes peaking at ~26.7 GB before it recovered; radius `-2`, `0`, `1e308` and `100`
(schema 0.2..3) were also applied. The web UI clamps, so this takes a stale page, a hand-edited
request or a schema changed under an open page, but the result is a hung Rhino.

**Decision:** clamp, not reject. `NumberRanges` clamps to the input's `NumberWidgetConfig` min/max
(integers round inward) before dedup, and the page gets a warning. Rejecting would leave the
definition on its previous value while the page shows the new one; clamping matches what a slider
does.

### 2.2 Rejected-value errors stick to every later solve (measured)

Validation errors ("Invalid numeric value", "Integer overflow", "Could not find item 'Banana'")
are added as runtime messages on the bridge component and reappear in `outcome.diagnostics` of every
following solve until the bridge restarts. Value solves expire only the changed params, never the
bridge, so nothing clears them, and `SolveDiagnosticsCollector` scans every object's messages.

**Decision:** value-update problems are no longer runtime messages on the bridge. They go to the
command line and to the page as a `runtimeMessage` toast. Schema save and sync messages stay on the
bridge: both re-solve it, which clears them.

### 2.3 A solve's `outputs` and its mesh frames can interleave with the next solve's (plausible)

`WebSocketTransport` broadcasts the `outputs` envelope, then each blob as its own awaited broadcast,
each taking the per-client send lock separately. The outputs task is fire-and-forget
(`DocumentEventManager.cs:415`), so a fast next solve can queue its envelope between the previous
solve's frames. `WebSocketServer` also drops any message, binary frames included, once 10 sends are
pending on a client. The client (`websocket-solve-driver.ts:100-147`) pairs frames to envelopes by
arrival order only: an interleave shows the previous solve's mesh as the new result, a dropped frame
leaves the solve unresolved. Needs a reader that stalls during a multi-MB send, which the panel does
while Rhino solves. Fix: send envelope plus frames as one group under one lock, pair on an id, and
never drop group members.

### 2.4 The slowest client paces every broadcast (code)

`BroadcastAsync` awaits `Task.WhenAll` over all clients, and each frame is awaited before the next.
One client that stops reading (a frozen panel next to a browser tab, the Shift workflow) holds every
other client until the 30 s send timeout.

**Decision (2.3 and 2.4):** each client gets its own send queue and drain loop in `WebSocketServer`.
A broadcast enqueues and returns; the `outputs` envelope and its frames are one queue item, so
nothing lands between them, and the authentication reply is queued under the lock that registers
the socket, so no broadcast precedes it. Nothing is dropped: a client with 256 MB unsent is
disconnected instead, and reconnects with a replay. The page keeps pairing by arrival order, which
is now sound; pairing by id was rejected as a protocol change the server no longer needs.

### 2.5 No exception guard in the SolutionEnd handler (plausible)

`GH_UIBuilderComponent.cs:292-347` serialises outputs synchronously in `SolutionEnd`. A throw there
escapes into Grasshopper and skips clearing contextual params, resetting pressed buttons and
draining pending values.

**Decision:** publishing and the input reset each run in their own try/catch; the drain is always
posted.

### 2.6 `_solveScheduled` never times out (plausible)

`ComponentStateManager` sets it when a solve is scheduled and clears it only on `SolutionEnd`. If the
scheduled callback throws, the solver is disabled or the document switches, no solve ends, and every
later update coalesces into `_pendingValues` forever. The UI looks dead until Enable is toggled.

**Decision:** a schedule that hasn't started after 2 s reads as clear. The next update takes the
stranded pending values and applies itself on top, so an older value can't land after a newer one.

### 2.7 Smaller ones (measured)

- **Cancel inside the schedule window is lost.** A cancel 5 ms after the update lands before the
  solve starts, finds nothing to abort, and the solve runs to completion. Grasshopper clears the
  abort flag when a solution starts.

  **Decision:** a cancel while a solve is scheduled arms a one-shot `AbortArm` that
  `DocumentSolveRuntime.OnSolutionStart` fires; Grasshopper honours an abort requested there. A cancel
  arriving while its update is still queued for, or applying on, the UI thread is queued again behind
  it, since no solve is scheduled yet. A cancel while idle arms nothing. Verified live at +0, +2, +30
  ms after the update.

- **An aborted solve reports `blocked=true` as well as `aborted=true`**, and first sends
  `progress {fraction: 1, done: 4/4}` under the last label: the remaining Report Progress
  components count as skipped steps. The UI can flash full progress for a cancelled solve.
  Progress for steps skipped by an abort is no longer emitted. `blocked=true` on an aborted solve
  stays: it means the result is withheld, which is true.
- **Enable false then true in one synchronous call** leaves the bridge Offline with a stale URL and
  both ports refusing. Separate calls work.
- **Restarting the bridge keeps session, secret and ports**, so old URLs stay valid, and connected
  clients see 1006 instead of a close frame.
- **About 9 concurrent clients max**; further ones are closed with 1008. Malformed JSON, unknown
  types and wrong session ids get no reply at all, which makes client bugs silent.

## 3. Server performance

### 3.1 Viewport preview delays the next queued solve (measured)

With `PreviewMode` Shaded, the next queued update starts a median 145 ms (max 550 ms) after a
199-sphere solve, against 32 ms with preview disabled: Rhino meshes the GH preview on the UI thread.
Finding 1 shrinks this as well.

### 3.2 A newer value never shortens a running solve (measured)

The page holds updates until `solvingState false`. With 4 × 1 s stages, a change sent 0.8 s into a
solve waited 3.4 s for the stale solve, then 4 s for its own. Worst-case latency is two full solves.
Coalescing itself is correct: 100 updates in 1 s gave 7 solves, 500 in 5 s gave 22, always ending on
the last value.

### 3.3 Aborted Display work keeps running (code)

`GH_WebDisplay` passes `CancelToken` only to `Task.Run`. The running `Parallel.For`/`ForEach` take no
cancellation token and no parallelism cap, so after a cancel the meshing finishes and is discarded
while the next solve competes for the same cores.

**Decision:** each item checks the token and is skipped once it's cancelled; a cancelled pass
returns no result and leaves `CacheAdmission` untouched. Both loops cap at `ProcessorCount - 1`. The
token isn't handed to `Parallel`, whose `OperationCanceledException` Grasshopper would read as a
faulted task.

### 3.4 Work repeated every solve (code)

- `SlvmChunks.Write` copies the whole geometry blob into a new LOH array every solve, even on a
  blob-cache hit (`SlvmChunks.cs:23,33`).
- Every Display batch is resent every solve, changed or not (`DocumentEventManager.cs:402`). A per-batch
  content id would let the page skip ones it already holds.
- Curves: each display item carries its NURBS `Json`, which the web ignores (`DisplayItem.cs:70`), and
  curves are re-tessellated and re-serialised every solve because only meshes are cached
  (`GH_WebDisplay.cs:771-785`).
- `GH_UIBuilderComponent.Write` rereads and rewrites the whole schema history file on every save,
  autosave, copy and undo snapshot (`SchemaBackupService.cs:71-115`), synchronously on the UI thread.

### 3.5 Gated solves still run everything (measured, fixture)

When the "Too many" gate blocks (200+ spheres), Display still meshes everything and ships nothing:
~1 s at 200, 2.6 s at 400. Voronoi 3D also runs (220–350 ms) in Spheres mode. A definition issue, but
it skews any perf run on this fixture.

## 4. Client decode

Measured on the captured 150-sphere frame (2.68 M triangles, 1.41 M vertices, merged into one mesh)
and the 151-cell Voronoi frame (5.7 k triangles).

| Frame      | Warm decode | Cold   | Main thread blocked (worker mode) | Peak RSS over baseline |
| ---------- | ----------- | ------ | --------------------------------- | ---------------------- |
| spheres150 | 560 ms      | 600 ms | 69 ms                             | 133 MiB (worker)       |
| voronoi150 | 3.2 ms      | 15 ms  | runs inline (under 50 k tris)     | 0.4 MB                 |

- **Two vertex welds per frame** (`mesh-assembly.ts:76-77`): `isClosedSolid` (234 ms) and
  `splitCreases` (206 ms) are 75% of decode. On this frame `splitCreases` split nothing, and the two
  weld the same positions separately. Share one weld, or skip crease splitting when the batch says
  its normals are smooth.
- **Inflate runs on the main thread even in worker mode** (`batch-parser.ts:370,376` →
  `binary/geometry.ts:51`): 62 of the 69 ms the main thread blocks. Move it into the worker.
- **Redundant `.slice()`** of vertex and index data (`batch-parser.ts:473-485`): 8 ms and 40 MB per
  frame. The inflated buffer is already private; only uncompressed blobs need the copy.
- **A stale parse can't be cancelled** and queues in the single FIFO worker
  (`websocket-solve-driver.ts:150-157`).
- **Picking is a brute-force raycast** over the merged mesh: 67 ms per click on this frame
  (`setup-events.ts:211-213`, `measure.ts:283`).
- Disposal on re-solve (`clearScene`, `disposeObjectTree`, `clearGeometryCache`) is correct; no GPU leak
  across solves.

**Decisions:**

- The two welds stay separate. `isClosedSolid` welds per member on a ±2-ulp grid; `splitCreases`
  welds exactly across the whole mesh, UVs and colours included. Sharing one would change normals and
  `closed` on real seams. Both loops got tighter instead: 231 → 188 ms and 206 → 170 ms.
- SLVZ chunks that inflate to 4 MiB or more inflate in fflate's async worker; below that the extra
  hop costs more than it saves. Not inside the assembly worker: that one is built from
  `fn.toString()` and can't embed fflate.
- The vertex and index arrays of a freshly inflated buffer are transferred, not copied. An
  uncompressed chunk still copies, since it aliases the frame the finished cache reads.
- A parse whose solve a newer one replaced is skipped before each blob.

Same geometry hash before and after on all three captured frames:

| Frame (warm decode) | Before | After  | Main thread blocked (worker) | Peak RSS (worker) |
| ------------------- | ------ | ------ | ---------------------------- | ----------------- |
| spheres150          | 671 ms | 539 ms | 70 → 1.8 ms                  | 135 → 93 MiB      |
| spheres150, Default | 33 ms  | 24 ms  | 7.3 → 6.9 ms                 | unchanged         |
| voronoi150          | 3.8 ms | 3.0 ms | runs inline                  | unchanged         |

Not yet seen in a real browser or the WebView2 panel; measured in Node with `worker_threads`.

## 5. Memory

- **`MeshItemCache` sits at its 1 GB cap** and evicts constantly during a slider sweep: about 77% of
  the managed heap. Keys include the placed geometry, so randomly placed spheres never repeat. Finding 1
  cuts entry size by ~18x; a cap well below 1 GB is still worth considering.
- **Caching transformed geometry buys nothing.** `MeshItemKey` holds the item's `DataCRC`, its bounds
  and its id, so a moved, rotated or scaled item always misses. A translation-invariant key would
  mean duplicating each Brep to measure it at the origin, and it still misses rotation and scale.
  With `Default` meshing at ~0.4 ms per sphere, that would cost about as much as it saves. The cache
  pays off where geometry repeats: material, name or layer changes, switching back to a variant, and
  upstream edits that leave an item alone.

  **Decision:** `CacheAdmission` gates inserts per Display component. After 3 solves with under 10%
  of lookups hitting, it stores only keys repeated from the previous solve; one solve at 10% or more
  stores everything again. Repeated keys count as hits, so geometry that stops moving (one static
  item among moving ones, or a material change after a drag) is cached the next solve without
  re-admitting the moving items. Rejected: a translation-invariant key (see above).

- **`GeometryBlobCache` under-counts**: each entry holds N `MeshItemKey`s but the LRU counts only
  `blob.Length` (`GeometryBlobCache.cs:21-37`).
- **Client `finished-cache`** holds up to 256 MiB of CPU arrays and plateaus after 4 distinct solves,
  so geometry-changing drags pay for memory that never hits (`finished-cache.ts:41,87-98`).
- **Receive buffers are kept for the socket's life**: one 150 MB file upload leaves up to a 256 MB
  `MemoryStream` pinned (`WebSocketServer.cs:789-798`).
- **Texture asset store never evicts** and re-hashes the full bytes on every resolve
  (`TextureAssetStore.cs:29,44`).
- Rhino's private bytes reached 6.1 GB under normal runs, mostly native and not attributed.

## 6. Held up under stress

- 300-solve soak alternating modes and sizes: no latency drift (p50 393–560 ms per 50-solve window),
  no wrong outputs, flat handle and thread counts.
- Protocol invariants over 62 solves including a cancel storm: seq order, `solvingState` pairing,
  binary frame counts, no duplicate diagnostics.
- Handshake: wrong or missing secret closes 4401 within 2 ms, wrong Origin is refused at upgrade,
  unauthenticated messages close 4401, a 5 MB pre-auth frame closes 4401. The bridge stayed healthy
  after every case.
- 5 concurrent clients all receive outputs and frames; a 50× reconnect storm and 20 cancels in 200 ms
  left the next solve normal.
- Re-sending an unchanged value does not solve. Cancel lands in ~51 ms with cancellation-aware
  components.

## Not covered

- Browser behaviour: the real panel page, WebView2 paint during the 35 ms window, GPU upload time.
- `SELVA_PERF_LOG` breakdowns of collect and send.
- Rhino 8 comparison of the meshing presets.
- Plausible items 2.3, 2.5, 2.6: each needs a targeted repro (a stalled reader, a throwing output, a
  disabled solver).
- Document close with the bridge enabled: whether port 8765 stays bound (`OnDocumentRemoved` only
  detaches events).
