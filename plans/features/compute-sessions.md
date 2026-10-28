# Compute sessions: keeping each user's solve warm

**Unfiled.** Design only; file an epic when someone commits to it.

Scope: several people solving the same definition on one Rhino.Compute at the same time, and how
each of them keeps a warm document. Spans the VektorNode `compute.rhino3d` fork (proxy routing,
the child's document pool) and Selva (who the caller is).

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
- **The proxy routes by queue order, not by caller.** `TakeChild` picks the first idle child and
  moves it to the back; a child that answers moves to the front again. The front is "whoever
  answered last", not "the child that holds your document".
- **Selva** runs one scheduler per compute server in `queue` mode, concurrency set to the child
  count. It coalesces identical concurrent solves (single-flight) and caches results by inputs, so
  identical requests never reach compute. Latest-wins happens per viewer in the browser.

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

A request header, `X-Compute-Session`, opaque to compute. A header rather than a body field
because the body is the solve-result cache key on compute (`cachesolve`) and the inputs are the
key in Selva's scheduler cache; a session id in either would make every user miss the other's
cached results.

Selva derives it per viewer tab and definition, hashed so it's not a user id: a log line may print
it. The proxy forwards only `RhinoComputeKey` to children today, so it has to pass this header on.

### 2. Proxy: tie a session to a child

A table from session key to child port, dropping entries after an idle period and when a child
exits. For a request with a key:

- Its child is alive and idle: use it.
- Its child is busy with **another** session: take an idle child if there is one (cold now, but
  parallel), and remap the session to it. Waiting would make this user queue behind someone else's
  solve.
- Its child is busy with **the same** session: wait. That's the user's own stale solve, and with
  `RHINO_COMPUTE_ABORT_ON_HANGUP` on it frees as soon as Selva drops it.
- No mapping, or no idle child: today's rule, then record the mapping.

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
retires its whole pool.

What already works per instance and needs no change: forgetting inputs after an abort, and the
live-event constants, which are set on every request. The solve-result cache keys on the body, so
it doesn't care which instance answered.

### 4. Selva

It sends the key. Nothing else changes: scheduler concurrency already follows the child count.
Single-flight across sessions stays correct: two sessions asking for identical inputs share one
solve on one child, and the other session's document simply diffs against its own last inputs
next time.

## Capacity

Everyone stays warm only while active sessions ≤ children × documents per child, and solves run in
parallel only up to the child count. Four users on one child with four documents are all warm but
take turns. Four users on four children with one document each are warm and parallel, as long as
affinity holds. Children cost a Rhino process each (memory and core-hours); documents cost memory
only. Which to spend depends on how big the definition's data is, so measure before picking
defaults.

## Order, and why

1. **Measure first.** Log when a session lands on a different child than last time; `recomputed`
   already shows the cost. This tells whether the thrash is real in production before anything is
   built.
2. **Proxy affinity.** Small, proxy-only, and the whole win whenever there are at least as many
   children as active users.
3. **The child's document pool.** Bigger, with real memory risk; needed only when users outnumber
   children.

Each step only acts on requests that carry the header, so each one can ship on its own and is a
candidate for McNeel as is.

## Open questions

- Granularity of the key: per tab and definition is the safe default. Per user would share a
  document across that user's tabs, which fight like two users do.
- Wait or go cold: the busy-with-another-session rule always goes cold. A definition whose warm
  solve is far cheaper than a cold one may be better off waiting a little. `Server-Timing` gives
  both numbers, so the proxy could learn the threshold per definition.
- Several compute VMs behind a load balancer need the balancer to keep the same affinity, hashing
  on the same header. Selva talks to whichever server URL is configured, so this is deployment
  work, not code.
- Idle child shutdown throws away every session's document on that child. That seems acceptable:
  an idle child has no active users.
- The first solve of every session is cold regardless, since its copy is parsed from the source
  bytes.
