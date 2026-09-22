# Live solve channel: one event seam, two transports

**Unfiled.** Design only; file an epic when someone commits to it.

Scope: **how a live connection between a running solve and the browser is made**, identically in
local Grasshopper and deployed (Rhino.Compute) Selva. What travels over it (progress, diagnostics,
cancel) is deliberately left open; the envelope is designed so that can grow without touching the
connection again.

Companion: [solve-diagnostics.md](./solve-diagnostics.md) covers the message model. That plan's
"unify the diagnostic" work is a prerequisite for this one and is worth shipping first on its own.

## Where we stand

|                  | Local (plugin-ui ↔ Selva.gha)                                    | Cloud (browser ↔ Selva server ↔ Rhino.Compute)                   |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Transport        | WebSocket on loopback, already live                              | HTTP request/response only, on both hops                         |
| Mid-solve events | Yes: `SolveMessageBroadcaster` sends from inside `SolveInstance` | None. The solve is one blocking `NewSolution` call               |
| Abort            | `RequestAbortSolution()`                                         | None                                                             |
| Diagnostics      | Structured (`level`, `source`, `isGate`)                         | Flat strings; warnings only when `Config.Debug`; remarks dropped |

Three facts about the Compute side decide the design (all in `compute.rhino3d`, the VektorNode fork):

1. **`rhino.compute` (the parent) buffers the whole child response** before forwarding a byte
   (`ReverseProxy.cs:447`, `ReadAsStringAsync`). Anything a child streams is flattened.
2. **Routing is blind round-robin** with no client→child affinity (`ComputeChildren.cs:101-182`).
   A browser cannot know which child holds its solve, so it cannot subscribe to it.
3. **One solve per child**, under a process-global `lock (ghSolveLock)`
   (`ResthopperEndpoints.cs:248`). Throughput scales with `--childcount`, nothing else. A live
   channel does not change this, and must not pretend to.

And one fact that makes the design cheap: Compute already injects per-request context into the
document as constants: `definition.Definition.DefineConstant("ComputeRecursionLevel", …)` at
`ResthopperEndpoints.cs:165`. Selva.gha runs _inside_ `compute.geometry` for every deployed solve
(that is what `ISelvaSerializableGoo` exists for), so anything Compute defines as a constant, our
own plugin code can read during the solve.

## The design in one paragraph

Events flow **outward from the solve**; the only way back in is the reply to an outward call. A
Selva.GH `SolveEventSink` is the one producer on both paths. Locally it broadcasts on the existing WebSocket. On Compute it POSTs to a
callback URL the Selva server put into the solve request, which `compute.geometry` handed to the
document as constants. The Selva server fans events out to the browser over SSE. The browser sees
one `SolveEvent` envelope through one `SolveDriver` seam, and the session code above the driver
does not know which world it is in.

```
LOCAL    Selva.GH sink ──WS frame `solveEvent`──▶ plugin-ui driver ─▶ SolveSession

CLOUD    Selva.GH sink ──POST /api/v1/solve-events/:solveId──▶ Selva server ──SSE──▶ selva driver ─▶ SolveSession
         (inside compute.geometry)      (per-solve HMAC token)      (in-process bus)
```

The parent proxy, child routing and the solve lock are untouched. Compute gains three lines of
plumbing and one env var.

## One envelope, one seam

**Envelope.** `SolveEvent` goes into `ui-schema.json` so it generates into both TypeScript and C#
(the cross-stack rule: one shape, one place). Header is fixed; `payload` is per-`type`:

```
SolveEvent { solveId: string; seq: number; at: string; type: string; payload: unknown }
```

`seq` is per-solve and monotonic so a consumer can drop late or duplicate delivery; SSE resumes with
`Last-Event-ID`, and the POST path may retry. `type` is an open string for the same reason the WS
envelope's `messageType` is: unknown types pass through, so adding one is non-breaking on both
transports. Day-one types: `solveStarted`, `solveEnded`, `diagnostic` (the structured
`SolveDiagnostic` from the companion plan, now with a channel that carries it on Compute too).
Everything else (progress, cancel-ack) is a later `type`, not a later transport.

**Seam.** `SolveDriver` in `@selvajs/solve/client` already abstracts "push transport" (WS) from
"request/response" (fetch). It grows one optional method, `onEvent(cb)`. `createSolveSession`
subscribes and reduces events into state. `SolveMessageDialog`, the footer badge and anything
else read session state, not the driver, so they are transport-blind by construction.

Two drivers implement it: `createWebSocketSolveDriver` maps the `solveEvent` WS frame;
`createComputeFetchSolveFn`'s driver maps the SSE stream. That is the whole client surface.

## Hop by hop

### Local: browser ⇄ Selva.gha

Already a WebSocket. Add one outbound envelope, `OutboundEnvelopes.SolveEvent(sessionId, event)`,
and a matching fixture (`WireFixtureContractTests` fails the build otherwise). `SolveMessageBroadcaster`
becomes the general `SolveEventSink`; its `BroadcastBlockedSolve` path is the first event type
migrated. Nothing else changes.

### Cloud, hop 1: compute.geometry → Selva server (callback POST)

The Selva server's `runSolve` mints `solveId` and a token, and adds one block to the request it
already builds via `applyOptionalComputeSettings`:

```
selvaevents: { url: "<ORIGIN>/api/v1/solve-events/<solveId>", token: "<hmac>" }
```

`compute.geometry` checks the URL's host against an allowlist and defines three document constants:
`SelvaEventUrl`, `SelvaSolveId`, `SelvaEventToken`. **Define them on every request, empty when the
block is absent.** Cached definitions are live `GH_Document`s reused across requests; a constant
left over from the previous solve would post that solve's events to the wrong tenant.

Inside the solve, the Selva.GH sink reads those constants from `OnPingDocument()`, and POSTs
events to the URL with the token as a bearer. Fire-and-forget on a background sender with a bounded
queue: the same rule `SolveMessageBroadcaster` already enforces, that nothing on the solver thread
ever waits on the network. Coalesce events within a short window (~50 ms) into one POST; keep a
static keep-alive `HttpClient`.

Why the sink is in Selva.GH and not compute.geometry: it is the same class, same queue, same
coalescing on both paths, with only the `Send` delegate bound differently (`HeadlessGuard.IsHeadless`
picks). Compute contributes constants, not networking. Every Selva-family plugin gets the channel by
reading three constants; the fork stays a thin seam, as with `ISelvaSerializableGoo`.

### Cloud, hop 2: Selva server → browser (SSE)

`GET /api/v1/solve-events` opens a session-scoped SSE stream (auth: the existing session or share
token, same guards as `/api/v1/compute`). The first event carries a random `streamId`. The browser
sends `streamId` with every solve POST; the server routes that solve's events to that stream. Events
carry `solveId`, and the driver applies the "latest solve wins" rule the WS driver already uses, so a
slow solve's late events cannot repaint a newer result.

One stream per tab, opened lazily on the first solve, reconnecting via the browser's built-in
`EventSource` retry with `Last-Event-ID`. Heartbeat comment every 20 s so idle proxies keep it open.
Headers: `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Caddy flushes
`text/event-stream` responses automatically; nginx needs the header.

The server already serves SSE this way (`api/admin/system/update`), so the pattern is proven in
this codebase and on `adapter-node`.

`solveStarted` and `solveEnded` are emitted **by the Selva server itself**, around its own call to
the scheduler. The stream is therefore useful the day it ships, against an unmodified Compute; the
callback hop only adds mid-solve events on top.

## Why outward callback, not streaming through the proxy

The obvious design is SSE or WS from `compute.geometry`, relayed by `rhino.compute`. It needs: a
non-buffering relay route in the parent, a streaming write path in the child that bypasses the
deliberate `Content-Length` (set to work around a Node chunked-500 hang, `ResthopperEndpoints.cs:257`),
a solve-id handshake or sticky routing so the browser can find its child, and a rethink of the
100 s proxy timeout. Four changes across two processes, all in the fork, all on the hot path.

Pushing outward removes every one of them. The child knows exactly where its events go because
the request told it; the parent never sees them; affinity is irrelevant; the request/response solve
is unchanged, so the proxy timeout still bounds only the solve. It also survives Compute being
behind NAT or a load balancer, and it is how every webhook on the internet already works.

The cost is the reverse dependency: Compute must be able to reach the Selva server. `scaling.md`
already says to put them in one VPC for the fat server→compute hop, so this is not a new
requirement.

## Security

- **Browser → Selva server.** Existing auth on both the SSE route and the solve POST. `streamId` is
  random and bound to the session; a solve POST naming a `streamId` from another session is rejected.
- **Selva server → Compute.** Existing `RhinoComputeKey`. The callback URL is set by the server,
  never by a browser, so a client cannot aim Compute at an arbitrary host.
- **Compute → Selva server.** Per-solve bearer token, `HMAC-SHA256(SELVA_HMAC_KEY, solveId ‖ exp)`,
  expiry = `solveDeadlineMs` plus slack, compared constant-time. Stateless verification, so it works
  across server instances. The route rejects an unknown or finished `solveId`, is exempt from the
  user rate limiter and has its own small per-`solveId` cap.
- **Compute-side allowlist.** `RHINO_COMPUTE_EVENT_SINK_HOSTS` (deny by default; the feature is off
  until set). Only an API-key holder can send a solve request, so this is defence in depth against a
  leaked key being used as an SSRF hop, in the spirit of the existing `--block-private-urls`.
- **Payload hygiene.** Events carry identifiers and diagnostics, never input values or geometry.
  The data-privacy rule for logs applies: nothing in an event should be something erasure has to
  chase.
- Document constants live in process memory only; `compute.geometry` never saves the document.

## Performance at ~20 concurrent users

- **Solve throughput is unchanged.** Twenty simultaneous solves queue on `childcount` children
  exactly as today. The channel makes the wait _visible_, it does not shorten it.
- **Events.** A solve emits a handful to a few dozen small POSTs, coalesced, over a keep-alive
  connection inside the VPC. Rounding error next to the response payload.
- **SSE.** Twenty idle HTTP connections on Node cost nothing. Fan-out is an in-memory map keyed by
  `solveId`.
- **Backpressure.** Bounded queue in the sink; if it fills, drop `progress`-class events oldest
  first and never drop `diagnostic` or `solveEnded`. Bound the SSE write side the same way.
- **Fast solves cost nothing.** A solve shorter than the coalescing window (~50 ms) produces zero
  network traffic from inside the solve: emitting is an enqueue, the first flush never comes, and
  the pending batch is discarded at solve end because the HTTP response already carries the final
  state. The heartbeat starts only after ~500 ms. So a 5 ms solve pays three dictionary reads and
  nothing else.
- **Chatty components.** Under `instanceSolve` a component emitting progress every iteration can
  produce hundreds of events a second. The sink dedupes `progress` by `(source, type)` within the
  window, keeping only the latest, and caps events per second; past the cap, progress drops and
  diagnostics still go through. Document-level progress sidesteps this entirely — the sink samples
  it on the heartbeat rather than receiving it, so its rate is fixed at 2/s whatever the graph does.
- **Second Selva instance.** The `solveId → stream` map is in-process, the same constraint the
  rate limiter already has (`scaling.md`). Hide it behind a `SolveEventBus` interface with an
  in-memory implementation now; a shared-store implementation is the multi-instance extension, and
  no caller changes.

## Compute changes, exactly

All additive, tagged `VEKTORNODE: SELVA — live events` per `FORK_CHANGES.md`:

1. `IO/Schema.cs`: `[JsonProperty("selvaevents")] SelvaEventTarget { Url, SolveId, Token }`,
   ignored when null.
2. `ResthopperEndpoints.cs` next to the `ComputeRecursionLevel` line: validate host, then
   `DefineConstant` the three values (empty strings when absent, see the cache footgun above).
3. `Config.cs`: `RHINO_COMPUTE_EVENT_SINK_HOSTS`.

Independently, and worth doing first: lift `if (Config.Debug)` off the warning loop in
`LogRuntimeMessages` (`GrasshopperDefinition.cs:727`). Deployed warnings do not exist today.

## What `GH_Document` already gives the sink

The sink holds a `GH_Document` for the whole solve, and the document exposes more than
`ConstantServer`. Five members carry weight here; the first fills a hole in the design and the
second closes a correctness gap.

**`SolutionProgress(out int objectIndex, out int maximumIndex)`** returns a percentage, 1–99, plus
"component 34 of 210". It is **document-level**, so it works on any definition, including one built
entirely from stock components by an author who has never heard of Selva. Without it, `progress` can
only ever come from Selva-authored components emitting it by hand, and most definitions would show a
spinner forever.

Sample it on the heartbeat tick the reply channel already needs (~500 ms) and attach it to that POST.
Sampling rather than emitting is what makes it cheap: the event rate is the poll rate, fixed,
independent of graph size, and a solve shorter than the heartbeat never samples at all. Report
`objectIndex`/`maximumIndex` alongside the percentage — the percentage counts components, not time,
so one heavy component in two hundred pins the bar at 40% while "34/210" stays honest.

The sampling thread is not the solver thread, so a read may tear or throw while the solver mutates
the document. That is already survivable: the sink swallows and a failed sample degrades to no
progress for that tick.

**`SolutionDepth`** counts nested solutions. Clusters solve their contents as a subsidiary solution,
which is why Compute tracks `ComputeRecursionLevel` at the very line the callback constants attach
to. Three things break at depth > 1: lifecycle events fire once per level, so one user action looks
like several solves; progress reports the inner solution and resets per cluster; and `abort` becomes
ambiguous about what it ends. Gate `solveStarted`/`solveEnded` on `SolutionDepth <= 1` and stamp the
depth on every event. One property read.

**`AbortRequested`** is the read side of `RequestAbortSolution()`. Without it a cancelled solve
reaches the browser as a truncated result and the UI infers the rest; with it, `solveEnded` carries
`reason: "aborted"` and says so.

**`RuntimeID`** (assigned once, never changed) turns the cached-document footgun from a discipline
into a check. Defining the constants on every request is the fix, but it holds only as long as no
future edit adds an early return, and the failure is a cross-tenant leak that nothing fails at build
time. Cache `(RuntimeID, SelvaSolveId)` when the solve starts and refuse to send if the pair read
later disagrees. The guard lives in Selva.GH, on the side of the boundary we own, not in the fork.

**`SolutionSpan`, `SolutionHistory`, `Profiler`.** Already recorded — the last 1000 solution
timespans are kept whether anyone reads them or not. Attaching `SolutionSpan` to `solveEnded` is a
line, and it answers "why was that slow" better than queue position does, because it points at the
definition rather than at the wait. `Profiler` opens per-component timing later, as a new `type`.

And two that look useful and are not, so nobody re-proposes them: **`ScheduleSolution`** is the
standard "run this after the solve" hook, but it is a UI-thread timer and headless Compute has no
message pump to fire it — the background sender covers both paths uniformly instead.
**`AppendToDebugLog`** invites exactly the logging the data-privacy rule forbids; §Security's payload
hygiene applies to document-level logs too.

## Rejected alternatives

- **Stream from the child through `rhino.compute`.** See above: relay, affinity, timeout, and the
  chunked-encoding workaround all in the way.
- **Async job model on Compute** (POST returns a job id; poll or stream it). The right long-term
  shape for very long solves, but it rewrites the solve endpoint, the cache, and every client, and
  cancellation no longer needs it: the reply channel covers that. The callback design keys everything by `solveId`, so a job model can be
  adopted later underneath it without changing the event contract.
- **Browser talks to Compute directly.** Exposes the API key and the compute network. Never.
- **WebSocket from Selva server to browser.** SvelteKit has no native WS; it means a custom server
  and losing `adapter-node`'s defaults. The browser's upstream is the solve POST already, so the
  stream only needs one direction. SSE is the boring, adequate answer.
- **Browser polls the server.** Strictly worse than SSE on latency and load.
- **Child opens an outbound WebSocket to the Selva server per solve.** More state, more code, no
  benefit at this scale. If POST overhead ever matters, it is a second `Send` delegate behind the
  same sink.
- **Sink in compute.geometry instead of Selva.GH.** Duplicates the queue and coalescing logic in a
  repo we want to keep thin, and other Selva-family plugins would not get it.

## Inbound: the callback reply is the return channel

SSE is one-way and Compute has no listener during a solve, so "interact with a running solve"
sounds impossible on the deployed path. It is not, because the sink already talks to the server
mid-solve: every event POST gets a reply. The reply carries the server's instructions back:

```
POST /api/v1/solve-events/<solveId>   body: SolveEvent[]
200 { abort: boolean }
```

The sink sets `RequestAbortSolution()` on the document when `abort` is true, and Grasshopper stops at
the next component boundary, the same cooperative abort `GH_Message` uses today. A heartbeat POST
from the sink's background thread every ~500 ms bounds abort latency even when no component is
emitting, and carries a `SolutionProgress` sample while it is there. `AbortRequested` is read back
at solve end so `solveEnded` can say it was cancelled rather than leaving the browser to infer it
from a truncated result. The browser asks for the abort with an ordinary `POST /api/v1/solve/:solveId/cancel`,
which flips a flag on the server's `solveId` entry; the next reply carries it.

No new transport, no Compute change beyond the constants, and an aborted solve _releases the child
lock early_, so this is the one feature here that shortens the queue rather than only making it
visible.

Locally the same request maps straight to `RequestAbortSolution()`, with one gotcha: inbound WS
frames are marshalled to the UI thread, which the solver occupies. A `cancel` frame must be handled
on the socket thread and only flip the abort flag; marshalling it queues it behind the solve it is
trying to stop.

## Two uses that motivate it

**Early value-list return.** A dynamic value list usually sits near the start of the graph, so it
_solves_ early. Two tiers:

- Streaming: the component emits `valueListUpdated` from `SolveInstance` the moment it computes. The
  dropdown refreshes within milliseconds while the rest of the solve continues. Compute time is
  unchanged; perceived latency is gone. The event carries a revision, which gives the DVL protocol
  the identity [dynamic-value-list-loop.md](../fixes/dynamic-value-list-loop.md) says it lacks.
- Probe: the request carries `mode: "probe"`, one more document constant. The value list component
  emits its values and calls `RequestAbortSolution()`; downstream is skipped and the child is free
  in milliseconds. With several value lists at different depths, abort only after the last one has
  solved. `FindAllDownstreamObjects` answers this directly — ask the document what still depends on
  this component rather than counting instances and tracking a per-solution tally, and a value list
  with an empty downstream set can abort on the spot.

**Mid-solve warning the user can act on.** A component computes something implausible from the
inputs and emits a `warning` diagnostic from `SolveInstance`. The browser shows it immediately; the
user may abort through the reply channel above, or do nothing and get the result through the normal
acknowledgement dialog at the end. "Continue" is the absence of an abort, so nothing has to pause.

## Extension points, by name

- New event kinds: a new `type` in `ui-schema.json`. No transport change.
- New inbound instructions: a new field on the callback reply. `abort` is the first; a per-solve
  input override or "skip this branch" would ride the same reply.
- Multi-instance fan-out: second `SolveEventBus` implementation.
- Transport swap on the callback hop: second `Send` delegate in the sink.

## As built (2026-09-22, branch `felix/state-machine` + fork branch `feat/selva-live-events`)

The tracer slice follows the design above with these deviations, each deliberate:

- **End-of-solve flush, not discard.** `SolveEventCallbackSender` posts whatever is still queued
  at `SolutionEnd` if the queue is non-empty. A 5 ms solve that emitted nothing still produces no
  traffic; one that raised a warning sends one POST after the fact. Cheaper to reason about than
  "which events did the response already cover".
- **`seq` is re-stamped by the server.** The plugin numbers its own batch, but the bus assigns the
  per-solve sequence on publish so server-originated `solveStarted`/`solveEnded` and plugin events
  share one monotonic run. SSE `id:` is a separate stream-level counter for `Last-Event-ID`.
- **The tab mints `streamId`**, not the server, so a solve request can name it before the stream
  has connected. The server accepts any 16–64 char URL-safe id and binds it to the session's
  owner key.
- **Share-token viewers get no stream.** The SSE and cancel routes require a session; anonymous
  public-link solves run exactly as before, without live events. Adding share-token support is a
  route-level change (resolve the token, use `share:<linkId>` as the owner key), not a design one.
- **Schema version bumped to 2.15.0** with a no-op migration: the codegen guard versions every
  definition in `ui-schema.json`, and `SolveEvent` had to live there for the cross-stack rule.
- **`SolveMessageBroadcaster` stays.** The blocked-outputs envelope is a different thing from a
  live event (it is what opens the dialog), so `GH_Message` now does both: emits a `diagnostic`
  event on the live channel and, on error, the blocked envelope as before.
- **The local cancel is a `cancelSolve` WS frame**, handled on the socket's dispatch thread and
  never marshalled; the compute cancel is the callback reply. Both reach
  `GH_Document.RequestAbortSolution()`.
- **UI surface is minimal:** `SolveLiveBanner` shows diagnostics from the running solve with an
  Abort button, only while solving. Everything else reads `session.liveEvents`.

Not verified live yet: an end-to-end run against a Compute with `RHINO_COMPUTE_EVENT_SINK_HOSTS`
set (the fork targets .NET 10 and could not be compiled on the authoring machine), and the local
abort path in Rhino.

## Verified against Rhino 8.35 (2026-09-22)

`GH_Document.ConstantServer` is a public `SortedDictionary<string, GH_Variant>`. `DefineConstant`
overwrites an existing key in place, an empty-string value round-trips, and the dictionary survives
`NewSolution` and `ExpireSolution` + `NewSolution`. A component reads
`OnPingDocument().ConstantServer["SelvaSolveId"]._String` during `SolveInstance` with no further
plumbing. The Compute leg rests on this and it holds.

Not yet verified, and worth the same treatment before anyone builds on it: whether
`SolutionProgress` can be read from the sender thread while the solver mutates the document, and
what `SolutionDepth` actually reads inside a cluster.

## Open questions

1. Should the SSE stream be per tab or per browser session shared across tabs? Per tab is simpler
   and matches "latest solve wins"; revisit if tab counts become a problem.
2. Whether `solveStarted`/`solveEnded` should include queue position. The server knows its FIFO
   depth, and it answers a different half of "why is this slow" than `SolutionSpan` does: queue
   position explains the wait, `SolutionSpan` explains the solve. Both are cheap; the question is
   whether the wait is ever the surprising half once progress is live.
