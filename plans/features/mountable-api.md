# A mountable API: one core, many hosts

> **No epic issue — deliberately.** This is being finished in one sitting rather
> than tracked, so the "What executing it taught" section below carries the
> handoff: the recipe, the traps, and — under "What is actually left" — the
> measured remainder and the order the dependencies imply. Per
> [CONVENTIONS](../CONVENTIONS.md) a plan owns reasoning and not status, so
> verify those counts against the tree before trusting them. File an epic if this
> stalls and needs picking up cold.

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

## What executing it taught

The design above was written from measurement and held up. This section records
what was only learnable by doing it — the traps, and the recipe that came out of
the first handler actually moving.

### The `get_status` trap, and why there are three error boundaries

Guards used to throw SvelteKit's `error()`. Moving them into the package meant
raising `ApiError` instead, and that is where a silent status bug nearly shipped.

SvelteKit derives a response status in `get_status` (`@sveltejs/kit/src/utils/error.js`):

```js
error instanceof HttpError || error instanceof SvelteKitError ? error.status : 500;
```

Anything else is a **500**, and `handleError` runs after the status is fixed — it
can rewrite the message but not the code. So an `ApiError` that escapes to
SvelteKit renders the right message under the wrong status, which reads as a
crash rather than a denial and never trips a test that only asserts on the
message.

The conversion therefore has to happen at the throw site, which is why three
boundaries exist rather than one. They are not redundant; each serves a caller
class the others cannot reach:

| Boundary      | Converts for                                   | Can set status |
| ------------- | ---------------------------------------------- | -------------- |
| `mapAppError` | mounted API routes (the normal path)           | yes            |
| `asHttpError` | page loads, and routes building own `Response` | yes            |
| `handleError` | backstop — a guard called outside both         | **no**         |

`handleError`'s `ApiError` branch is deliberately a backstop and is commented as
one. Deleting it would lose the message; relying on it would lose the status.

Two real regressions surfaced here, both caught by the existing suite:

- **A disclosure bug.** `concealAccessFailure` in `compute/solve.server.ts` turns
  a 403 into a 404 so a guessable guid cannot be probed for existence. It matched
  on `isHttpError`, so once guards raised `ApiError` the 403 leaked. It now reads
  the status off either shape — the two error types coexist by design, and code
  matching only one is the failure mode to watch for.
- The binary file proxy and the solve routes returned 500 where they had
  returned 403/404, because they build their own `Response` and never reach
  `mapAppError`.

### Redirecting guards cannot move, and that is the whole split

Four guards stayed in the app: `assertPagePermission`, `assertManageInstanceUsers`,
`assertManageCompute`, `assertAnyPlatformPermission`.
A redirect is a browser-page outcome that a framework implements by throwing a
value only it recognizes, so these cannot be framework-free by construction.

The split was decided on **evidence, not naming**. Rather than trusting the
`assert*` / `require*` convention, every export was mapped to its call sites. The
convention did hold — but it also revealed `assertCanGrantPlatformPermissions` as
misnamed: it takes a `ctx`, does not redirect, and has three API callers, so it
moved with the rest. Only three page-load call sites existed in the whole app,
so the conversion cost was near zero.

### `AccessDeps` is what makes any of this possible

Guards take an injected `AccessDeps` rather than resolving module globals. That
looks like ordinary hygiene and is actually the load-bearing constraint: Selva's
`providers.server.ts` has a top-level `await createSelvaProviders()`, so a
handler that transitively imports it **boots the app** — which no package test,
and no other host, can tolerate.

The same property is why the moved handler tests need no equivalent of Selva's
`setTestProviders`: a handler reaches every store through `req.deps`, so a test
needs only the harness it passes to `callHandler`.

Worth re-verifying after any handler move: no file under the package's
`handlers/` reaches `providers.server`.

### Moving a handler: the recipe

`orgMembers.ts` went first, chosen because it was the cleanest — its only
non-package imports were `access.server` and `v1/bodies`. The steps generalize:

1. **Move its shared dependencies first.** They are usually smaller than they
   look and framework-free already.
2. **Leave a re-export shell in the app.** Every existing call site stays
   byte-identical, so the move is not entangled with a rename. `registry.ts`
   still derives the OpenAPI spec from the same Zod values because they are the
   same values.
3. **Move the tests with the handler.** This is the point of the exercise, not a
   follow-up — tests that stay behind are the thing that diverges.
4. **Mutation-check in the new location.** Green after a move proves nothing
   about whether the tests still bite.

### The tests are the deliverable, and the harness is how they travel

A handler test needs a real provider stack, but `@selvajs/server` ships none —
which stack a host runs on is the host's decision, and a package that picked one
would drag it into every consumer's dependency tree.

Resolution: `@selvajs/local-provider` is a **devDependency**, and the factory
lives in `handlers/__tests__/harness.ts`, which `package.json#files` already
excludes. The published package still ships no provider.

The shared tenant casts (`seedAcme`, `seedBigClient`, `seedThirdOrg`) moved into
`@selvajs/server/testing` alongside the tests. They compose only the existing
seeders, so they run on whatever stack a host builds its `TestHarness` around —
and a host that reseeds its own Acme with different roles would otherwise get
different results from the same test. `freshProviders` stays in the app, because
picking a stack is exactly the host's job.

One test stayed behind: `removal-revokes-invites.test.ts` mints through the real
`createInvite` handler, so it cannot move until `invites.ts` does.

### What is actually left

Measured after `orgMembers` moved — **one handler file of fourteen**, which is
about 5% by volume:

|                   | Moved | Remaining       |
| ----------------- | ----- | --------------- |
| Handler files     | 1     | 13              |
| Handler functions | 2     | 39              |
| Handler LOC       | 263   | 1,447           |
| Test files        | 4     | 12 (~1,529 LOC) |

That percentage understates progress. The first move paid for infrastructure
that does not recur — `access/guards.ts`, `api/bodies.ts`, `api/pagination.ts`,
`testing/scenarios.ts`, and the package test harness. What remains is mostly
repetition of the recipe above.

**Nine app modules still block handlers, but only one genuinely.** Eight are
already framework-free: the apparent coupling is a re-export shell
(`access.server`, `pagination.server`) or, in `definitions/visibility.server.ts`,
a mention of `providers.server` **inside a comment**. They are 25–201 LOC each.
The real blocker is `invites/deliver.server.ts`, which imports `providers.server`
for real — and which gates only `invites.ts`.

The blockers fan out very unevenly, which sets the order:

| Blocker                         | LOC | Unblocks                                        |
| ------------------------------- | --- | ----------------------------------------------- |
| `definitions/visibility.server` | 201 | `definitions`, `definitionVersions`, `projects` |
| `compute/resolve.server`        | 47  | `definitions`, `definitionVersions`             |
| `organizations/OrgAssetService` | 81  | `services`                                      |
| `compute/serverConfigWrite`     | 125 | `orgCompute`                                    |
| `compute/evictChangedServers`   | 37  | `orgCompute`                                    |
| `projects/createProject.server` | 94  | `projects`                                      |
| `permissions-scope.server`      | 29  | `invites`                                       |
| `invites/lookup.server`         | 25  | `invites`                                       |
| `invites/deliver.server`        | 51  | `invites` — **the one real blocker**            |

`visibility.server` is the highest-leverage move by a wide margin: the three
files it unblocks are the three largest, 641 LOC of the remaining 1,447.

**Six handlers are unblocked right now** — their only app-relative imports are
the two re-export shells: `me`, `me.starred`, `orgs`, `reclaim`, `shareLinks`,
`orgAssets` (236 LOC together). A workable order is those six first, since they
prove the recipe repeats before any prerequisite work; then `visibility.server`
to unlock the big three; then the small one-to-one blockers; `invites.ts` last,
both because it holds the only real blocker and because `deliver.server.ts` is
in flight on the notifications branch.

One caveat on the easy six: `me`, `me.starred`, `orgs` and `orgAssets` have **no
direct handler tests**. Moving an untested handler is a different risk from
moving `orgMembers`, whose 25 tests were what made that move verifiable. Either
write tests as part of the move or move them knowing the route-level tests are
the only cover.

Two pieces of the surface were exempted from the start and remain so: the three
streaming routes (`POST /compute`, `POST /compute/schema`,
`POST /definitions/{guid}/solve`), which hand-roll error conversion three
different ways — a `mountStreaming` wrapper was proposed and deferred — and
`/api/admin`, per the sequencing above.

Also known and unresolved: `callHandler` does not pass Selva's env-resolved
`uploadLimits`, so those tests run against `depsFromConfig` defaults (50MB/10MB).
The definition-file cap is covered; the image cap is not.

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
