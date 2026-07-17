# [Verify]: Drive a real slider drag end-to-end and measure what one drag actually costs

**Status:** open · **Labels:** `verification` · **Blocking:** a fix already shipped on this assumption (B9) and several more are queued behind it
**Related:** audit items B9 (done), C4, 4b, B5-lb in [0.data-access-efficiency-audit.md](./0.data-access-efficiency-audit.md)

## What do we currently believe?

Everything below came from **reading code, not running it**. The whole slider→solve path
has now been traced statically, and the trace produced four claims that nothing has
confirmed against a live system:

1. **The rate limit contradicts the debounce.** `COMPUTE_RATE_LIMIT_MAX=120` per
   `COMPUTE_RATE_LIMIT_WINDOW_MS=100_000` (`packages/server/src/compute/limits.ts:210-211`)
   = **1.2 solves/sec sustained**. The slider debounce is **150ms**
   (`packages/ui/src/lib/components/preview/inputs/NumberInput.svelte:27-28`) = up to
   ~6.6 solves/sec. If both numbers are what they look like, a user scrubbing a slider for
   ~20 seconds exhausts the window and gets 429s for the remainder. The two values appear
   to have been chosen independently of each other.
2. **~8 uncached DB reads per solve**, all for rows that don't change during a drag:
   definition, project, project_member, version, plus a 4-query cluster in
   `getConfig` to resolve the compute server (`SupabaseComputeServerStore.ts:53`).
   Trace at `packages/selva/src/routes/api/compute/+server.ts:202-286`.
3. **Single-flight coalescing is inert by default.** `+server.ts:335` gates it on
   `solveCache != null`, and `SOLVE_CACHE_PROVIDER` defaults to `'off'`
   (`packages/selva/src/lib/server/computeLimits.ts:83`), so every solve takes the
   `nocoalesce:` random-key branch. Dogpile protection is coupled to the L2 backend being
   mounted, which looks unintentional.
4. **`incrementSolveCount` is one unbatched Postgres RPC per successful solve**
   (`+server.ts:421`) — the same shape as the problem B9 just fixed, still live.

**Why this matters enough to file:** B9 was fixed on the strength of exactly this kind of
static reasoning, and the trace afterwards showed it was roughly the _fifth_-biggest cost
on the path. The audit called it P1. The reasoning was locally correct and the ranking was
wrong. That is the failure mode this issue exists to stop repeating — the next four items
should not be prioritized off code reading alone.

## How would we find out?

Drive one real drag against a real stack (Supabase provider, a real compute server, one
app instance) and capture what actually happens. Not a load test — one user, one slider,
one honest measurement.

1. Stand up the app against Supabase with default env (importantly: **do not** set
   `SOLVE_CACHE_PROVIDER`, so the default `off` path is what gets measured).
2. Open a definition with a slider input and drag it continuously for ~30 seconds at a
   natural speed, then in short bursts, then slowly (moves spaced >150ms apart — the case
   where the debounce never coalesces).
3. Capture, per drag:
   - **Requests actually issued** — browser devtools network panel. How many `/api/compute`
     POSTs, how many were aborted by the throttle's latest-wins, how many returned 429.
   - **Time to first 429**, if it happens at all.
   - **DB queries per solve** — Supabase dashboard query stats, or `pg_stat_statements`
     diffed across the drag. Confirms or refutes the "8 reads" count.
   - **`increment_run_count` call count** — should equal successful solve count if claim 4
     holds.
   - **Solve metric rows written** — should be far fewer INSERT statements than solves now
     that B9 batches. This is the check that B9 does what we think it does in situ.
4. Record the numbers in this file and update the audit's priority ordering against them.

## What would each outcome mean?

**Claim 1 (rate limit vs debounce)**

- _Confirmed (drag gets 429'd)_ → this is a **user-facing bug**, not a scaling concern, and
  outranks every efficiency item in §B/§C. Fix is a decision, not a patch: either the limit
  rises, or the debounce lengthens, or slider solves stop counting against the same bucket.
  Needs a product call on what a drag is _supposed_ to cost.
- _Refuted (no 429 in practice)_ → the debounce plus latest-wins abort collapse a drag to
  far fewer real requests than the arithmetic suggests. Then the client is doing its job and
  the limiter is correctly sized; record the real solves/sec so the next person doesn't
  re-derive the scary number from the constants.

**Claim 2 (8 uncached reads)**

- _Confirmed_ → request-scoped memoization of those reads is the highest-leverage server fix
  available, worth more than B9 was. Dovetails with C4 and 4b, which are currently P2/P1
  and should probably merge into one piece of work.
- _Refuted (fewer reads, or they're cheap)_ → downgrade C4, stop planning around it.

**Claim 3 (single-flight inert)**

- _Confirmed_ → decouple coalescing from `solveCache != null`. Note this may be **moot for
  drags specifically** (every frame is a distinct value, so nothing coalesces regardless)
  but very much not moot for the real dogpile case: many users hitting the same shared
  definition at the same value.
- _Refuted_ → the gate is deliberate; document why.

**Claim 4 (`incrementSolveCount` unbatched)**

- _Confirmed_ → give it the buffering treatment `SupabaseSolveMetricSink` already has. It's
  a run _counter_; it does not need to be transactional per solve.
- _Refuted_ → nothing to do.

**Meta-outcome regardless of the above:** this is also the first real in-situ check of the
B9 batching. If solve metric INSERTs don't drop to roughly `solves ÷ 100` (or one per 2s,
whichever binds), the batching isn't working the way the unit tests suggest.

## Affected Components

- [x] Cloud App (@selvajs/selva)
- [x] Shared UI (@selvajs/ui)
- [x] Core / Compute

## Notes

- The client side of this path is in good shape and this issue is **not** a prompt to change
  it: 150ms/400ms debounce, single in-flight solve, `AbortController` latest-wins threaded
  all the way into the compute call, and an LRU result memo keyed on stable-serialized
  inputs. If the measurement says something is wrong, suspect the server or the limit
  config before touching the throttle.
- One open product question surfaced by the trace, worth deciding separately: bits-ui
  exposes `onValueCommit` (fires on pointer release) and `NumberInput` doesn't use it. That
  would collapse a drag to one solve. Live geometry during a drag is presumably the
  intended feature, so this is a product decision, not a defect.
