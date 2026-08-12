# [Verify]: Drive a real slider drag end-to-end and measure what one drag actually costs

> # ⚠️ RETIRED UNRUN — 2026-07-31. The measurement described below never happened.
>
> **Nothing in this file was confirmed against a live system.** No `pg_stat_statements` diff, no
> browser drag against a real stack. It was archived because it had sat unactioned and was
> starting to read as a pending check rather than an abandoned one. Do not cite any number here
> as verified.
>
> **Where the content went:** the two surviving claims (rate limit vs drag, ~8 uncached DB reads)
> are folded into **C4** in
> [data-access-efficiency-audit.md](../fixes/data-access-efficiency-audit.md) with explicit
> unverified markers. Claim 3 was **fixed in code** (single-flight now unconditional; the
> `SOLVE_CACHE_PROVIDER` var it depended on no longer exists). Claim 4 became audit item **C11**.
>
> **The one durable lesson, and the reason this file is kept rather than deleted:** claim 1's
> original "~6.6 solves/sec" was itself a static-reading error — it derived a rate from the 150ms
> debounce without checking the trailing-edge semantics or the single-in-flight throttle
> downstream, both of which bound it far lower. That error survived two weeks _inside the document
> written to warn against exactly that failure mode_, alongside the B9 story it was filed to
> prevent repeating. Two static analyses of this path produced two wrong conclusions. That is the
> takeaway worth carrying forward.
>
> ## ⚠️ 2026-07-31 (later, same day) — the retirement note is ALSO wrong. Third error, same family.
>
> The correction above says the throttle bounds the request rate to `1/solveRTT` and therefore
> "sustained natural dragging sits far below" the limit, downgrading this to "narrow, needs a human
> to sustain a pathological pattern for ~100 seconds". **That reasoning does not survive simulation.**
> It treats the two limiters as if they compose to the _stricter_ of the two bounds. They don't:
> the throttle bounds _concurrency_, not rate — it drops superseded values, but every debounce fire
> that lands while nothing is in flight starts a real request immediately.
>
> The composition (trailing debounce 150ms → single-in-flight latest-wins → 16-entry LRU memo →
> network) was simulated as a discrete-event model mirroring `debounce.ts`, `async-throttle.ts` and
> `solve-memo.ts`. Result, against the 120-per-100s server limit:
>
> | Drag style                                              | Network requests | Peak/100s | 429?    |
> | ------------------------------------------------------- | ---------------- | --------- | ------- |
> | Continuous scrub, 16ms frames, 100s, 100ms solve        | **1**            | 1         | no      |
> | Discrete moves @160ms, 100s, 50ms solve                 | 626              | 625       | **yes** |
> | Discrete moves @160ms, 100s, 500ms solve                | 202              | 200       | **yes** |
> | Discrete moves @**500ms**, 100s, 50ms solve             | 201              | 200       | **yes** |
> | Discrete moves @160ms, values **revisited** (memo hits) | **1**            | 1         | no      |
>
> **Three things the prose got wrong:**
>
> 1. **The window is far wider than "just over 150ms".** Moves spaced up to ~830ms apart still trip
>    it. Anything slower than ~1.2 moves/sec is over the limit by definition, because the limit _is_
>    1.2/sec — the debounce only has to fail to coalesce, which it does at any spacing past 150ms.
>    A user nudging a slider once or twice a second for 20 seconds is not a pathological pattern.
> 2. **The throttle only rescues genuinely slow definitions.** Sweeping solve RTT: the 429 persists
>    until RTT ≈ **833ms**. Below that the throttle is not the binding constraint and never becomes
>    one. "At a ~500ms solve that is ~2/sec" was right about the rate and wrong about the conclusion —
>    2/sec is still 167% of the sustained limit.
> 3. **Time to first 429 is ~19 seconds**, not ~100. The 100s figure came from reading the window
>    length as though the budget were spent evenly across it; 120 requests at ~6/sec exhausts it in
>    a fifth of the window.
>
> **What actually saves normal use is the memo, not the throttle** — and neither the original claim
> nor the correction mentions it. Continuous scrubbing issues 1 request because the debounce
> coalesces; revisiting values issues 1 because the 16-entry LRU hits. The dangerous pattern is
> _deliberate, spaced, monotonic_ movement — exactly what someone does when tuning a parameter to
> find a value, which is the primary use of a slider.
>
> **Also undocumented anywhere in this plan:** a 429 arms a **client-side cooldown**
> (`packages/selva/src/routes/library/[guid]/+page.svelte:30,49-52`) that short-circuits subsequent
> solves and surfaces `Rate limit reached. Try again in Ns.` So the user-visible failure is not a
> silent retry — it is an error message mid-tuning, and the cooldown means it does not clear on the
> next nudge.
>
> **Status of the claim: confirmed by simulation, still unconfirmed against a live stack.** This is
> a model of the real code, not a browser drag — the simulation could be wrong in the same way the
> prose was. But it is now the _fourth_ analysis, the first one that is executable and reproducible,
> and it inverts the priority the retirement note assigned. The harness lives in this file's history;
> re-derive rather than trusting the table if it matters. **Do not downgrade this again from a
> reading of the constants.**
>
> Historical content follows unchanged.

---

**Status:** retired unrun · **Labels:** `verification` · **Was blocking:** C4's priority
**Related:** audit items B9 (done), C4, C11, 4b, B5-lb in [data-access-efficiency-audit.md](../fixes/data-access-efficiency-audit.md)

**Scope at retirement:** claim 1 (can a drag hit the rate limit?) and claim 2 (~8 uncached DB
reads per solve). Claims 3 and 4 were already closed.

> **2026-07-31 — re-verified against HEAD. Two of the four claims are closed; scope is now
> claims 1 and 2.** Claim 3's premise no longer exists (the gate is gone, and so is the env var
> it keyed off). Claim 1's **arithmetic was wrong** — the corrected bound is below, and it
> downgrades this from "likely user-facing bug" to "worth confirming the pathological case".
> Claim 4 moved out to the audit as a plain fix item; it never needed a measurement plan.
> Line references were re-anchored to HEAD at the same time (the originals had drifted ~70 lines).

## What do we currently believe?

Everything below came from **reading code, not running it**. The whole slider→solve path
has now been traced statically, and the trace produced four claims that nothing has
confirmed against a live system. Two are still open:

1. **The rate limit may contradict the debounce — but only in the pathological case.**
   `COMPUTE_RATE_LIMIT_MAX=120` per `COMPUTE_RATE_LIMIT_WINDOW_MS=100_000`
   (`packages/server/src/compute/limits.ts:280-281`) = **1.2 solves/sec sustained**. The bucket
   is keyed per user (`user:${id}`, or `share:${linkId}`) at `+server.ts:170`, so if this
   triggers it bites one user scrubbing alone; it does not need concurrency.

   **Corrected 2026-07-31 — the original "~6.6 solves/sec" was wrong**, and the correction
   matters because it was the number that made this look urgent. Two client-side limiters sit
   between the slider and the network, and the original arithmetic accounted for neither:

   - **The debounce is trailing-edge** (`packages/ui/src/lib/utils/debounce.ts` — every call
     clears the prior timer). A _continuous_ drag therefore emits **nothing at all** while the
     pointer keeps moving; it fires once, 150ms after the user stops. The 6.6/sec figure
     assumed a leading-edge or per-interval fire, which is not what this is.
   - **The solve throttle is single-in-flight with one latest-wins pending slot**
     (`packages/solve/src/client/async-throttle.ts`). Even when the debounce does fire
     repeatedly, requests cannot overlap: real request rate is bounded by **solve round-trip
     time**, not by the debounce interval.

   So the true ceiling is `min(1 / 0.150, 1 / solveRTT)` per second. At a ~500ms solve that is
   ~2/sec, and a slower definition self-limits further. Sustained natural dragging sits far
   below both. **The case that could still 429 is narrow:** repeated discrete moves spaced
   _just over_ 150ms apart — fast enough that the debounce fires every time, slow enough that
   it never coalesces — against a definition fast enough that round-trip time doesn't throttle
   it. Whether a human actually produces that for ~100 seconds is the open question.

2. **~8 uncached DB reads per solve**, all for rows that don't change during a drag:
   definition, project, project_member, version, plus a 4-query cluster in
   `getConfig` to resolve the compute server (`SupabaseComputeServerStore.ts:79-93`).
   Trace at `packages/selva/src/routes/api/compute/+server.ts:190-300`.
3. ~~**Single-flight coalescing is inert by default.**~~ **CLOSED 2026-07-31 — fixed, and the
   premise is gone.** Two things changed since this was written. The gate is removed:
   `+server.ts:313-316` now wraps _every_ solve in the coalescer, and the comment there states
   the reason this issue predicted — dogpile protection matters most when nothing else is
   caching. Cancellation was untangled from cache config at the same time: `hasWaiters`,
   decided by the coalescer at join time, now determines whether a disconnect aborts the
   flight (`+server.ts:333-352`), where previously enabling a cache silently changed
   disconnect semantics. Separately, `SOLVE_CACHE_PROVIDER` **no longer exists** — it was
   deleted with the whole L2 solve-result cache (see the archived
   [caching-simplification](../archive/caching-simplification.md) plan), because its only
   shipping implementation was an in-process `Map` behind the same restart boundary as the
   scheduler's L1, and L1 is consulted first — so L2 could only ever serve what L1 had already
   evicted. Nothing to measure and nothing to configure: the `ISolveResultCache` seam in
   `@selvajs/platform` is where a real shared backend (Redis) would mount if in-process
   caching stops being enough.
4. ~~**`incrementSolveCount` is one unbatched Postgres RPC per successful solve.**~~ **MOVED
   2026-07-31 → audit item C11.** Still true at HEAD (`+server.ts:434` →
   `SupabaseDefinitionStore.ts:220`), but it doesn't belong in a measurement plan: the fix is
   ~10 lines mirroring `SupabaseSolveMetricSink`'s buffering, and it neither blocks nor is
   blocked by the drag measurement. Deliberately **not** implemented ahead of the measurement —
   this is the exact shape B9 had, and B9 came fifth. It should ride along with whatever the
   drag measurement finds, not preempt it.

**Why this matters enough to file:** B9 was fixed on the strength of exactly this kind of
static reasoning, and the trace afterwards showed it was roughly the _fifth_-biggest cost
on the path. The audit called it P1. The reasoning was locally correct and the ranking was
wrong. That is the failure mode this issue exists to stop repeating — the remaining items
should not be prioritized off code reading alone.

**This has now happened twice.** Claim 1's original "~6.6 solves/sec" was itself a static-reading
error of the same family: it read one constant (the 150ms debounce) and derived a rate from it
without checking the two limiters downstream that actually bound the rate. It survived in this
file — the file written to warn about exactly this — for two weeks. Treat the numbers below as
hypotheses, including the corrected one.

## How would we find out?

Drive one real drag against a real stack (Supabase provider, a real compute server, one
app instance) and capture what actually happens. Not a load test — one user, one slider,
one honest measurement.

1. Stand up the app against Supabase with default env.
2. Open a definition with a slider input and exercise three drag styles. **The third is the
   one that matters** — the corrected analysis says the first two cannot 429:
   - **Continuous scrub, ~30s.** Trailing-edge debounce predicts this issues ~1 request
     total, on release. Mostly a check that the prediction is right.
   - **Short bursts.** A few requests per burst; bounded by solve RTT.
   - **Discrete moves spaced just over 150ms**, sustained for ~100s. This is the only style
     that can reach the limit: every move clears the debounce _and_ fires it. Use a fast
     definition, so solve RTT doesn't become the binding constraint instead.
3. Capture, per drag style:
   - **Requests actually issued** — browser devtools network panel. How many `/api/compute`
     POSTs, how many were aborted by the throttle's latest-wins, how many returned 429.
   - **Observed solves/sec**, against the predicted ceiling `min(1/0.150, 1/solveRTT)`. If the
     continuous scrub issues materially more than ~1 request, the debounce is not behaving as
     read and that finding outranks everything else here.
   - **Time to first 429**, if it happens at all.
   - **DB queries per solve** — Supabase dashboard query stats, or `pg_stat_statements`
     diffed across the drag. Confirms or refutes the "8 reads" count.
   - **Solve metric rows written** — should be far fewer INSERT statements than solves now
     that B9 batches. This is the check that B9 does what we think it does in situ.
4. Record the numbers in this file and update the audit's priority ordering against them.

## What would each outcome mean?

**Claim 1 (rate limit vs debounce)** — expectation after the correction is **refuted for normal
use, possibly confirmed for the spaced-move case only**.

- _429 on the spaced-move case only_ → a real but narrow bug. Fix is a decision, not a patch:
  either the limit rises, or the debounce lengthens, or slider solves stop counting against the
  same bucket. Needs a product call on what a drag is _supposed_ to cost. Weigh it against how
  plausible that input pattern is for a real person over ~100 seconds.
- _429 on continuous or burst dragging_ → the corrected model is **also** wrong, which is the
  most important outcome on this page. Stop and re-derive before fixing anything: two successive
  static analyses of this path would have failed.
- _No 429 anywhere_ → the client is doing its job and the limiter is correctly sized. Record the
  real solves/sec **in this file** so nobody re-derives a scary number from the constants a
  third time.

**Claim 2 (8 uncached reads)**

- _Confirmed_ → request-scoped memoization of those reads is the highest-leverage server fix
  available, worth more than B9 was. Dovetails with C4 and 4b, which are currently P2/P1
  and should probably merge into one piece of work.
- _Refuted (fewer reads, or they're cheap)_ → downgrade C4, stop planning around it.

**Claim 3 (single-flight inert)** — resolved without measurement; nothing to capture. The gate
is gone and so is the env var that drove it (see claim 3 above). Worth recording that it was
**moot for drags either way**: every frame of a drag is a distinct value, so nothing coalesces
during a scrub regardless of the gate. What the fix buys is the real dogpile case — many users
hitting the same shared definition at the same value.

**Claim 4 (`incrementSolveCount` unbatched)** — moved to audit item C11; no longer scoped here.
It is confirmed-by-reading and needs no measurement. If the drag measurement happens to show
the RPC dominating, raise C11's priority then.

**Meta-outcome regardless of the above:** this is also the first real in-situ check of the
B9 batching. If solve metric INSERTs don't drop to roughly `solves ÷ 100` (or one per 2s,
whichever binds), the batching isn't working the way the unit tests suggest.

## Affected Components

- [x] Cloud App (@selvajs/selva)
- [x] Shared UI (@selvajs/ui)
- [x] Core / Compute

## Notes

- The client side of this path is in good shape and this issue is **not** a prompt to change
  it: 150ms/400ms trailing-edge debounce, single in-flight solve with one latest-wins pending
  slot, `AbortController` threaded all the way into the compute call, and an LRU result memo
  keyed on stable-serialized inputs. Three independent mechanisms already suppress redundant
  solves. If the measurement says something is wrong, suspect the server or the limit config
  before touching the throttle.
- **The `onValueCommit` idea is largely redundant** and the original note overstated it. It
  claimed switching to bits-ui's `onValueCommit` (fires on pointer release) "would collapse a
  drag to one solve" — but a trailing-edge debounce already does that for a continuous drag:
  the timer resets on every move, so nothing fires until the user pauses. The real difference
  is narrow: `onValueCommit` also suppresses the intermediate solves during a _slow_ drag
  (pauses >150ms mid-gesture), at the cost of killing live geometry during the drag, which is
  presumably the intended feature. Still a product decision, but a much smaller one than
  "N solves → 1".
