# Caching

Solving a Grasshopper definition is the expensive part of Selva. Caching avoids
repeating work. There are **three independent caches**. They **stack** — they are
not either/or. You can turn each on or off on its own.

This page is the simple version: what each one does, where to change it, and what
it costs.

---

## The 30-second summary

| #   | Cache                             | What it skips                      | Where it lives                    | Default   |
| --- | --------------------------------- | ---------------------------------- | --------------------------------- | --------- |
| 1   | In-process response cache         | the network call **and** the solve | Selva's server process (RAM)      | always on |
| 2   | Pointer reuse                     | re-uploading the `.gh` binary      | Selva ↔ Rhino.Compute             | on        |
| 3   | Server solve cache (`cachesolve`) | the solve                          | Rhino.Compute server (RAM + disk) | on        |

Picture of one solve request:

```
Browser ──► Selva server ──► Rhino.Compute
            (cache 1, 2)      (cache 3)
```

Nothing is cached in the browser. "Selva server" means the Node process that
runs the app, not the user's machine.

---

## What each cache actually does

### 1. In-process response cache — _fastest, but local_

The first thing checked on every solve. If the **same definition with the same
inputs** was solved recently, Selva returns the stored result immediately and
**never calls Rhino.Compute at all**.

- ✅ Skips both the network round-trip and the solve.
- ❌ Lives in one server process's memory — **lost on restart**, and **not shared**
  if you run more than one Selva instance.
- Misses the moment any input changes (a moved slider is always a miss).

### 2. Pointer reuse — _stops re-uploading the file_

The other two caches store **results**. This one is different: it changes **how
the definition is sent**.

Normally Selva uploads the whole `.gh` binary (can be many MB) on **every** solve.
With pointer reuse, it uploads once, gets back a cache key, and afterwards sends
just that key. Rhino.Compute already has the definition.

- ✅ The only cache that helps when **inputs change** (e.g. slider scrubbing),
  because it doesn't depend on inputs — it just shrinks the upload.
- ❌ Does **not** skip the solve. The definition still solves; you just didn't
  re-send it.
- If the server forgot the key (it restarted, or a new instance handles the
  request), Selva automatically re-uploads the full file. No error.
- **Safety note:** this auto-recovery needs a Rhino.Compute server that reports a
  forgotten key correctly (the VektorNode fork does). On an unknown server, a
  forgotten key could return empty geometry — so turn it **off** if you point
  Selva at a Rhino.Compute server you don't control. See the setting below.

### 3. Server solve cache (`cachesolve`) — _durable, shared_

Asks Rhino.Compute itself to remember solve **results**, keyed on definition +
inputs, and hand back a stored result on an identical repeat.

- ✅ Lives on the Rhino.Compute server (memory + disk), so it **survives Selva
  restarts** and is **shared across all Selva instances**.
- ❌ Still costs a network round-trip (cache 1 doesn't). Still misses when inputs
  change.

---

## Which should I turn on?

- **Defaults (all on except none):** caches 1, 2 and 3 are on out of the box —
  fine for most setups. Identical re-solves hit cache 1 (or cache 3 across
  instances / after a restart); big definitions benefit from pointer reuse.
- **Compute server is memory-constrained, or definitions emit large outputs:**
  consider `COMPUTE_SERVER_CACHESOLVE=false` — cache 3's stored results live in the
  server's memory + disk, and that's the heaviest cost of the three.
- **Big definitions / lots of slider scrubbing:** pointer reuse (cache 2) is the
  one that helps — keep it on. The result caches won't, because the inputs keep
  changing.
- **Pointing at a Rhino.Compute server you don't control:** set
  `COMPUTE_REUSE_DEFINITION_CACHE=false` to be safe (see cache 2's safety note).

---

## Where to change settings

All three are configured server-side, in
[`packages/selva/.env.example`](../packages/selva/.env.example) (copy to `.env`).
Defaults and parsing live in
[`packages/selva/src/lib/server/computeLimits.ts`](../packages/selva/src/lib/server/computeLimits.ts);
they're applied in
[`packages/selva/src/routes/api/compute/+server.ts`](../packages/selva/src/routes/api/compute/+server.ts).

| Setting                          | Cache | Default | What it does                                             |
| -------------------------------- | ----- | ------- | -------------------------------------------------------- |
| `COMPUTE_REUSE_DEFINITION_CACHE` | 2     | `true`  | Send a pointer instead of re-uploading the `.gh` binary. |
| `COMPUTE_SERVER_CACHESOLVE`      | 3     | `true`  | Let Rhino.Compute cache and return solve results.        |

Cache 1 (the in-process response cache) has **no env knob** — it's always on. Its
size and lifetime are hardcoded in `+server.ts` (`cache: { maxEntries: 20, ttlMs:
5 * 60_000 }` → keep 20 results for 5 minutes). Change those numbers there if you
need to.

After editing `.env`, restart the Selva server for changes to take effect.

---

## What does it cost?

Caching trades memory/disk for speed. The costs are small but real.

| Cache                  | Performance benefit                                           | Memory / disk cost                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. In-process          | Best — instant, no network, no solve                          | Up to 20 full results in the Selva process's RAM. A result with a big geometry/file output can be tens of MB, so worst case ~hundreds of MB. Capped at 20 and 5 min, then evicted. |
| 2. Pointer reuse       | Skips a multi-MB upload per solve. Big for large `.gh` files. | Negligible on the Selva side (just a small key per definition). On the Rhino.Compute side it keeps each definition in memory (it does that anyway).                                |
| 3. Server `cachesolve` | Skips the solve, but still a network round-trip               | Server-side memory **and disk**. Rhino.Compute evicts under memory pressure, but on a busy server with large outputs this is the heaviest cost of the three.                       |

Rough guidance:

- Caches 1 and 2 are cheap wins — leave them on.
- Cache 3 is the one to watch: it's the most useful in multi-instance setups but
  also the most memory/disk-hungry on the Rhino.Compute box. Turn it on
  deliberately, and keep an eye on the server's memory if your definitions
  produce large outputs.

---

## Real-world examples

### A. One person scrubbing a slider on a 40 MB facade definition

The user drags a "panel count" slider; every change re-solves. Inputs change every
time, so the **result** caches (1 and 3) never hit. What hurts is re-uploading
40 MB on every drag.

- **Pointer reuse (2)** is the hero: the 40 MB uploads once, then each solve sends
  a tiny pointer. Uploads drop from 40 MB × N to 40 MB once.
- Caches 1 and 3 do nothing here — and that's expected.
- **Settings:** defaults are right (`COMPUTE_REUSE_DEFINITION_CACHE=true`,
  `COMPUTE_SERVER_CACHESOLVE=false`).

### B. A public configurator with a few fixed presets

A product page lets visitors pick from, say, 6 preset configurations. Many people
click the same presets. Same definition, same inputs, over and over.

- **Cache 1** catches repeats on a warm instance — instant, no compute call.
- **Cache 3** matters because it's a public app on **multiple instances**: visitor
  X warms instance A, visitor Y lands on instance B. Cache 1 on B misses, but
  cache 3 on the shared Rhino.Compute server hits — Y still skips the solve.
- **Settings:** turn on `COMPUTE_SERVER_CACHESOLVE=true`. Keep pointer reuse on.

### C. A single internal tool, one instance, restarted on each deploy

An in-house Selva instance, one Node process, redeployed a few times a day.

- **Cache 1** does most of the work day-to-day. After a deploy it's cold and
  refills naturally.
- **Cache 3** would survive the restart, but for one low-traffic instance the
  benefit is small and it adds server memory/disk use.
- **Settings:** defaults. Leave `COMPUTE_SERVER_CACHESOLVE=false`.

### D. Selva pointed at a Rhino.Compute server you don't own

You're using a shared/third-party Rhino.Compute endpoint and don't know how it
behaves when it forgets a definition.

- **Risk:** pointer reuse (2) assumes the server reports a forgotten key so Selva
  can re-upload. An unknown server might instead return empty geometry.
- **Settings:** set `COMPUTE_REUSE_DEFINITION_CACHE=false`. You'll re-upload the
  `.gh` every solve (slower for big files) but you're safe. `cachesolve` is the
  server's own feature and is harmless to request.

---

## How to tell a cache is working

Each solve response carries a `Server-Timing` header with `decode`, `solve`, and
`encode` durations.

- **Cache 1 hit:** the request returns near-instantly and you won't see a fresh
  server timing at all (Selva answered without calling Rhino.Compute).
- **Cache 3 hit:** the request still goes to the server, but the `solve` time
  drops to ~0 (the server skipped the solve and returned a stored result).
- **Cache 2 working:** the outgoing request body to Rhino.Compute is small — it
  carries a `pointer` with `algo: null` instead of the full base64 `.gh`.
