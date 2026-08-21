# A mountable API: one core, many hosts

## The problem, stated from evidence

Selva's `/api/v1` is 44 handler methods over ~4,000 LOC of route files, plus 26
more under `/api/admin`. None of it is reachable from outside the SvelteKit app.

parafa is the proof that this costs something. It imports `@selvajs/platform`
70 times — types, Zod schemas, pure permission predicates — and that layer works
well. But it imports `@selvajs/server` only **11 times total**, and then carries
**4,794 LOC** of its own `src/lib/server/`, a near-mirror of Selva's 5,776:

| parafa                              | selva                               |
| ----------------------------------- | ----------------------------------- |
| `compute/resolve.server.ts`         | `compute/resolve.server.ts`         |
| `compute/limits.ts`                 | `computeLimits.ts`                  |
| `compute/rateLimit.server.ts`       | `computeRateLimit.server.ts`        |
| `admin/auth.server.ts`              | `admin-auth.server.ts`              |
| `admin/bootstrap.server.ts`         | `auth-bootstrap.server.ts`          |
| `team/inviteToken.server.ts`        | `invites/`                          |
| `apiHelpers.server.ts`              | `api-errors.ts` + `api/v1/route.ts` |
| `definitions/catalogView.server.ts` | `definitions/visibility.server.ts`  |

The reuse boundary sits at `@selvajs/platform` — data shapes and pure predicates
— and everything above it, the orchestration, falls off a cliff.
`@selvajs/server` was meant to be that layer but only ever caught leaf
utilities: SSRF guard, rate limiter, body-size check.

## What this is not

**Not "parafa mounts Selva's 47 endpoints."** That was the initial framing and
the code does not support it. Of parafa's 17 routes, ~5 are the same domain as
Selva's (`definitions`, `versions`, `compute`, `compute/schema`, `files`). The
other 663 LOC — `jobs` (347), `solutions` (238), `file-artifacts` (78) — are
parafa's own domain, and Selva should never grow them.

The win is that **parafa's own routes get to be thin**, not that parafa
inherits Selva's. A parafa-only route like `POST /jobs` still wants Selva's
error envelope, rate limiter, body-size guard and compute resolution. So the
shared pieces are useful to all 17 of its routes; the shared _handlers_ are
useful to about 5.

That reframing is why the layering below puts the transport core first and the
handler migration second, rather than treating them as one push.

## Why it is cheaper than it looks

Three measurements, taken before any code was written, decided the design:

1. **SvelteKit coupling in handlers is almost nil.** Across all 47 route files
   the only symbol imported from `@sveltejs/kit` is `json` (24 uses). No
   `redirect`, no `fail`, no `error` — those already funnel through `apiError`.
2. **`locals` is four fields**: `ctx` (44), `user` (12), `log` (6), `profile`
   (4). That is a context interface, not a framework dependency.
3. **`access.server.ts` declares its own `Locals`** — `{ user?, ctx? }`, 485 LOC
   and exactly one touch of the field. The nine `requireCanX` guards are
   therefore _already_ structurally satisfied by any object carrying `user` and
   `ctx`, including `ApiRequest`. The guards were the feared part of this work
   and they are close to free.

The handlers were written to the repo's own "parse, guard, delegate, serialize"
rule, and that rule is what makes them nearly transport-free today.

## The design

`@selvajs/server/api` — transport-free, ~250 LOC:

- `errors.ts` — `ApiError` as a plain exception, plus `apiError()` with an
  unchanged signature. This is the load-bearing trick: `apiError` was already a
  chokepoint, so all **151 call sites work untouched**; only the throw site and
  the boundary differ. SvelteKit's `error()` stays in the SvelteKit binding.
- `types.ts` — `ApiRequest` (ctx/user/profile/log/params/url/request/deps) and
  `ApiResponse` (`{ status?, body?, headers? }`, or a raw `Response` for
  streaming endpoints).
- `deps.ts` — `SelvaDeps` + `depsFromConfig(config, services)`. Replaces 77
  module-global getter calls.
- `respond.ts` — `runHandler`, with a `mapError` hook so app-specific errors
  (`ProviderError`, `SchemaExtractionError`, `ComputeServerUnconfiguredError`)
  stay in the app that owns them.
- `responses.ts` — `collection` / `created` / `noContent`.

A host binds it by building an `ApiRequest` and calling `runHandler`. Selva's
binding is **94 lines** and is the only file that knows both worlds. A Next,
Hono or Remix binding is a sibling roughly that size. That number is the whole
claim of this plan.

### Why `ApiResponse` is a value, not a `Response`

A handler that built its own `Response` would force every host to accept
web-standard `Response` semantics. Returning a value lets a host choose its own
serialization; the streaming endpoints that genuinely need a `Response` may
still return one.

### Why deps are injected rather than imported

`getProjectProvider()` and friends resolve from Selva's composition root. parafa
runs `@selvajs/supabase-provider` and exports its own `providers: SelvaConfig` —
the same shape, a different instance. Injection is what lets one handler serve
both. Verified structurally: every field of `SelvaDeps` maps onto parafa's
existing `providers.data.*` getters.

## Sequencing

**Selva first, then parafa** — and it is forced, not merely preferable. parafa
pins `@selvajs/server` 1.0.3, where `/api` does not exist. It cannot adopt until
this ships.

Convert in tranches of ~5 related endpoints, full suite per tranche. Order:

1. **Reads with no guard** — `/me`, `/projects` GET. Proves the seam.
2. **One guarded write** — `POST /projects`. Forces `requireCanCreateProject`
   onto `ApiRequest` and settles the guard question where it is cheap to get
   wrong.
3. **The rest of v1**, tranche by tranche.
4. **`/api/admin`** last, or not at all until a second app needs it. It shares
   `api/http.ts` with v1 so it comes along cheaply, but parafa's admin model is
   deliberately degenerate (`instance_admin` only) and may never want it.

Three routes stay exempt for now: `POST /compute`, `POST /compute/schema`,
`POST /definitions/{guid}/solve`. They stream and mark their own metrics, the
conformance test already exempts them, and they are the highest-risk,
lowest-reuse endpoints in the surface.

### Mount in parafa early, not at the end

parafa has **zero deployments**. That makes it a design partner rather than a
migration target: breaking its endpoint shapes is free, and mounting one
endpoint there surfaces flaws in `SelvaDeps`/`ApiRequest` while the fix costs
one file instead of forty. Point it at the workspace or a prerelease rather than
waiting on a version.

Everything currently known about parafa's fit is read from source, not run. That
is decent evidence and not proof.

## The ratchet

`api/v1/registry.ts` already declares the v1 contract as data — method, path,
Zod body validator, response kind, error statuses — and drives both the OpenAPI
generator and a conformance test that fails when routes and registry disagree.

That test caught both regressions introduced while building the prototype: a
missing error wrapper, and a hand-rolled pagination envelope — precisely the
drift it exists to prevent. It is what makes 40+ more endpoints tractable.

One change was needed to keep it honest: `loadRoutes` now inlines the source of
any handler a route mounts. Without that, every source-grep assertion would have
started passing vacuously against one-line route files — tests staying green
while progressively checking nothing, which is worse than a red test.

## Decisions worth recording

**`apiRoute` gets deleted at the end.** Two wrappers is fine during migration and
permanent drift if it stalls halfway. The conformance test's `(apiRoute|mount)`
regex is a temporary state, and treating it as temporary is what stops the fork.

**`resolveAccessibleProjects(ctx, deps?)` takes deps optionally.** It is a
tenancy boundary with two existing callers (the team-projects page load and
`GET /definitions`), both of which pass nothing and hit the identical singleton
path. Optional deps is what made the change zero-risk for them.

Its tests were written to fail when the wiring is wrong, and that was verified by
mutation: mis-mapping `orgs -> data.projects` fails three of them. The first
version of those tests **missed** a mis-mapped `platformProjectGrants` entirely,
because no fixture seeded a platform-visibility project — so a fourth test seeds
a cross-org platform project plus an explicit user grant, which is the only path
that reads that store. A test suite that cannot fail is worse than none, and this
one nearly shipped that way.

**Admin auth is a separate extraction.** It is session/cookie/rate-limit
machinery, not request handlers — it depends on neither `SelvaDeps` nor
`ApiRequest`, and can proceed in parallel.

It is worth doing on its own merits. parafa's login limiter is a single per-IP
fixed window; Selva's is two limiters, because neither dimension covers the
other. Per-address bounds one client hammering the form, but only when
`ADDRESS_HEADER`/`XFF_DEPTH` are set — behind a reverse proxy without them
`getClientAddress()` returns `127.0.0.1` for every request, five failed logins
from anywhere lock out the whole instance, and only a success clears it, which
nobody can now reach. Hence `warnIfAddressKeysCollapse`. Per-account bounds a
targeted guessing attack, which address limiting does not: an attacker spread
across IPs shares no counter. parafa has the first limiter, none of the
mitigation, and a `Caddyfile`.

Of parafa's 773 admin LOC, roughly 236 converge (`auth.server.ts`,
`userLifecycle.server.ts`). `bootstrap.server.ts` does **not**: it pins one
catalog org (`ADMIN_ORG_SLUG = 'parafa'`), carries a legacy-slug migration for
its own seeded data, and solves a different problem from Selva's IdP-callback
bootstrap despite sharing the word.

## Rejected

**A service layer without a transport core.** Extracting
`(deps, ctx, input) => Result<T, E>` operations and leaving each app to write its
own routes. Rejected because parafa would still hand-write route files that drift
from Selva's, and because the measurements above show the transport coupling was
never the expensive part — `apiError` and the four `locals` fields were the whole
of it.

**`createV1Router` mounting all endpoints via one catch-all.** Still reachable
later and the registry supports it, but it oversells the shared surface: parafa
would mount ~5 of 44. Per-route `mount()` keeps each app's route tree honest
about what it actually serves.

**Moving `@selvajs/ui` logic in the same pass.** Out of scope. Roughly 1,000 LOC
in `ui` is framework-free but trapped in a Svelte-only package
(`schema/visibility-rules.ts` most notably). Worth freeing eventually — `ui` is a
published semver package with external consumers, so it needs a deprecating
re-export rather than a move — but it is a separate piece of work with a separate
risk profile.
