# Compute sessions: keeping each user's solve warm

**Unfiled.** Design only; file an epic when someone commits to it.

Scope: several people solving the same definition on one Rhino.Compute at the same time, and how
each of them keeps a warm document. Spans the VektorNode `compute.rhino3d` fork (proxy routing,
the child's document pool) and Selva (who the caller is). The proxy half is
VektorNode/compute.rhino3d#23.

## How it works today

A warm solve needs a Grasshopper document that still holds the caller's last inputs. Then
`SetInputs` skips the unchanged ones and `NewSolution(false, …)` runs only what the changed ones
feed. Everything below is about whether a request finds such a document.

- **One document per definition per child.** The child's definition cache holds one shared
  `GrasshopperDefinition`. `CheckOut` hands it to the first solve; a solve that arrives while it is
  checked out (only nested Hops calls can, see the next point) gets a copy parsed from the source
  bytes, which is cold and is thrown away after.
- **One solve at a time per child.** Top-level solves run under the process-wide `ghSolveLock`.
  Grasshopper and the Rhino document are not thread-safe, so this stays. Parallelism comes from
  children only.
- **Without a session header the proxy routes by queue order, not by caller.** `TakeChild` picks
  the first idle child and moves it to the back; a child that answers moves to the front again. The
  front is "whoever answered last", not "the child that holds your document".
- **Selva** runs one scheduler per compute server in `queue` mode, concurrency set to the child
  count. It coalesces identical concurrent solves (single-flight) and caches results by inputs, so
  identical requests never reach compute. Latest-wins happens per viewer in the browser, which keeps
  one solve in flight per tab.

## What goes wrong with four users

Four people open the same definition and drag sliders. Two children, C1 and C2.

1. A solves on C1. C1's document now holds A's inputs.
2. B solves while A is in flight, so B lands on C2. C2 answers last and moves to the front.
3. A's next solve takes the front child, C2, which holds B's inputs. Every input where A and B
   differ is set again, and everything downstream of those runs. With real users on different
   slider positions, that is most of the graph.
4. C and D do the same. Each child's document ends up holding whoever solved last on it.

`recomputed` in `Server-Timing` shows it: close to `total/total` on solves that should be warm.
With one child it's worse: the four solves also wait on each other's lock. With four children it's
still random, because nothing ties a user to a child.

## Goals

- When capacity allows, a user's next solve lands on a document holding that user's last inputs.
- Memory stays bounded. A document holds the whole definition plus its data, so one per user
  can't be free.
- A request without a session key behaves exactly as today. That keeps stock deployments unchanged
  and the change offerable upstream.

Not a goal: parallel solves inside one child. The lock stays. Not a goal yet: routing across
several compute VMs (see open questions).

## Design

### 1. A session key on the request

`X-Session-Id`: opaque to compute, 1 to 128 printable ASCII characters (`!` to `~`). Compute
ignores a malformed one and routes the request as if it had none. A header rather than a body field
because the body is the solve-result cache key on compute (`cachesolve`) and the inputs are the key
in Selva's scheduler cache; a session id in either would make every user miss the other's cached
results. The proxy consumes it; children never see it.

### 2. Proxy: tie a session to a child

Built in #23 (FORK_CHANGES §22). A claim maps a session to a child, by port and process id, since a
replacement child reuses the port. A claim is a preference, not ownership: no request fails over
one, and a claimed child still serves anyone when nothing else is free (nested Hops calls carry no
header).

- Claimed child idle: use it (`hit`).
- Claimed child busy, with anyone's request including the session's own: run on another child and
  move the claim there (`spilled`), as that child now has the newest inputs.
- No claim, or its child is gone or expired: ordinary selection, preferring the least-claimed idle
  child, then claim it (`claimed`). Anonymous requests avoid claimed children the same way. With no
  claims, selection is exactly the old one.
- A 504 drops the claim and sends the child to the back of the queue: it may still be running the
  abandoned solve.
- `RHINO_COMPUTE_SESSION_TIMEOUT` (seconds a claim outlives its last request, default 3600) and
  `RHINO_COMPUTE_SESSION_MAX_CLAIMS` (default 256, `0` turns routing off). Past the cap a request
  routes as if it had no header.
- The outcome is logged at Debug with an 8-character hash of the id. Clients see nothing new.

An earlier draft waited when the claimed child was busy with the session's own stale solve. #23
never waits, because a new request must not queue behind or cancel one already running. That fits
Selva: the browser keeps one solve in flight per tab, so a busy own child means an abandoned solve,
which `RHINO_COMPUTE_ABORT_ON_HANGUP` stops anyway.

Rejected: consistent hashing of the session onto a child. It ignores load, so two busy sessions
can share a child while another sits idle, and it can't rebalance. Rejected: routing to the child
whose document is "closest" to the request's inputs. The proxy would have to diff inputs it
otherwise never parses, for a gain that affinity mostly gets anyway.

### 3. Child: a document per session

Replace the single shared instance with a small pool per definition, keyed by session.
`CheckOut(session)` returns:

1. that session's instance if it's free;
2. otherwise the least recently used free instance. It's warm for someone, and a diff against
   another user's inputs still beats parsing the definition again;
3. otherwise a new copy built from the source bytes, while the pool is under its cap.

The cap is per definition (a new setting, e.g. `RHINO_COMPUTE_SESSION_DOCS`, default 1, which is
today's behaviour), on top of the existing physical-memory limit on the cache. Eviction is least
recently used, through the existing `Retire`/`Release`. Dropping a definition from the cache
retires its whole pool. This needs the header forwarded to the child, which #23 does not do.

What already works per instance and needs no change: forgetting inputs after an abort, and the
live-event constants, which are set on every request. The solve-result cache keys on the body, so
it doesn't care which instance answered.

### 4. Selva: who the session is

Selva sends `X-Session-Id` on solves and keeps no session state: compute owns claims, expiry and
the cap. `runSolve` derives the id on every request:

```text
hex(HMAC-SHA256(SELVA_HMAC_KEY, "compute-session\0" + userId + "\0" + definitionKey))[0..32]
```

`definitionKey` is the definition guid for `local:` definitions and the URL for remote ones.

- **Stateless.** Nothing to expire, it survives restarts, and every Selva instance derives the same
  id because they share the key.
- **The client sends nothing,** so it can't mint ids to fill compute's claim cap. Claims are bounded
  by active users × definitions.
- **Keyed**, so a compute operator (a BYO server may be a third party) never sees a user id. A plain
  SHA-256 of a user id can be reversed by anyone who can enumerate ids.
- **Every authenticated path gets it.** Browser, API-token and MCP solves all go through `runSolve`.
- **Share-link solves send no header** and route as before. Selva has no identity for an anonymous
  visitor, and the link id would put every visitor in one session.
- **A missing `SELVA_HMAC_KEY` sends no header.** A routing hint never fails a solve.
- **Rotating `SELVA_HMAC_KEY` changes every id once.** Each session solves cold once, and the old
  claims count against the cap until they expire.

Per user and definition, not per tab. Two tabs of one user on one definition share a claim; when
both solve at once the second spills and the claim moves, so they thrash like two users would, but
never block each other. Per tab needs an id minted by the browser, which reopens the cap problem (a
client rotating ids) and changes `createComputeFetchSolveFn`, all for a rare case. The draft and
live versions of one definition share a claim, which helps: the child keeps a document for each.

Rejected: a session table in Selva (id, last seen, TTL). It duplicates what compute already
expires, needs sharing across Selva instances, and buys nothing a derived id doesn't.

Where it flows, one optional field per layer:

- **`@selvajs/compute`:** `sessionId?` on `ComputeConfig`, `GrasshopperClient`'s `SolveOptions` and
  `SchedulerSolveOptions`. The scheduler keeps it on the queued item and merges it into the
  per-solve config, as it does `selvaevents`. `buildHeaders` sends it as a transport header, so a
  caller's `headers` entry can't duplicate it, and throws `INVALID_CONFIG` on an id compute would
  ignore.
- **`@selvajs/solve/server`:** `SolveEngineSolveArgs.sessionId`, passed through `runSolvePipeline`
  to `solveDetailed`.
- **Selva app:** `computeSessionId(userId, definitionKey)` in `#lib/server/compute/`, using
  `hmacKeys()` like `solveEvents/token.server.ts`. `runSolve` passes it for `access.kind === 'user'`
  with a non-empty `userId`.

What stays out:

- **Every cache key:** the scheduler's response cache, the single-flight key, compute's solve-result
  cache. A coalesced flight routes on its first caller's id; a joiner's claim stays where it was,
  which is harmless for a hint. A scheduler cache hit sends no request at all.
- **`/io`, probes and `/limits`:** they use the client's base config, so they carry no id.
- **Browser callers of `@selvajs/compute`** only send it when they set it, and then the server's
  CORS must allow the header.

Also needed: a changeset for `@selvajs/compute` and `@selvajs/solve`, and one line in
[data-privacy.md](../../docs/self-hosting/concepts/data-privacy.md): compute servers receive a
stable keyed id per user and definition, which links one user's solves on that server without
naming them. When a deployable fork branch carries #23, the two compute settings go in
[rhino-compute.md](../../docs/self-hosting/get-started/rhino-compute.md).

Size: about 60 lines of code and 90 of tests. Tests: header sent, omitted, rejected when malformed,
not duplicable through `headers`; the scheduler hands each item's id to the executor and a cache
hit ignores it; the engine forwards it without touching the coalesce key; the derived id is stable,
differs by user and by definition, fits compute's format, and is absent for share links.

## Capacity

Everyone stays warm only while active sessions ≤ children × documents per child, and solves run in
parallel only up to the child count. Four users on one child with four documents are all warm but
take turns. Four users on four children with one document each are warm and parallel, as long as
affinity holds. Children cost a Rhino process each (memory and core-hours); documents cost memory
only. Which to spend depends on how big the definition's data is, so measure before picking
defaults.

## Order, and why

1. **Selva sends the header.** Safe on any server: one without #23 ignores it.
2. **Proxy affinity on every deployed branch.** #23 targets `9.x.state`. The self-hosting docs
   deploy `8.x.selva`, which needs a backport: it has the same `AcquireChild`, `TakeChild` and
   warm `CheckOut`, but not `IsChildAlive`, `ChildProcessId` or `PruneExitedChildren` (they came
   with the 9.x MCP work), nor the `Server-Timing` condition #23 edits in the proxy. Until then
   Rhino 8 deployments get no affinity.
3. **Measure.** `recomputed` in `Server-Timing` shows whether solves stay warm, but only on 9.x:
   `8.x.selva` has no solve timing. #23 reports `hit`/`spilled` at Debug only, so checking routing
   from Selva needs compute's logs. A `Server-Timing` entry for the outcome would put it in Selva's
   compute debug log.
4. **The child's document pool.** Bigger, with real memory risk; needed only when users outnumber
   children.

Each step only acts on requests that carry the header, so each one can ship on its own and is a
candidate for McNeel as is.

## Open questions

- Share-link visitors get no affinity. A browser-minted tab id, keyed with the link id, would give
  them one, but needs a per-link cap so one visitor can't rotate ids into the claim cap.
- Wait or go cold: #23 always goes cold. A definition whose warm solve is far cheaper than a cold
  one may be better off waiting a little. `Server-Timing` gives both numbers, so the proxy could
  learn the threshold per definition.
- Several compute VMs behind a load balancer need the balancer to keep the same affinity, hashing
  on the same header. Selva talks to whichever server URL is configured, so this is deployment
  work, not code.
- Idle child shutdown throws away every session's document on that child. That seems acceptable:
  an idle child has no active users.
- The first solve of every session is cold regardless, since its copy is parsed from the source
  bytes.
