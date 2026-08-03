---
'@selvajs/server': minor
'@selvajs/selva': minor
---

The v1 API gets a definition-addressed solve, a generated OpenAPI contract that a test keeps
honest, and one shared shape for every handler in the tree.

## `POST /api/v1/definitions/{guid}/solve`

The flagship action, and what the CLI's `solve` command maps to. It shares the whole solve core
with `POST /api/v1/compute`, which was extracted into `$lib/server/compute/solve.server.ts`.

The core takes a `SolveAccess` discriminated union (`user` | `share`), and the definition-addressed
route can only construct `user` — so it cannot inherit the anonymous share-token branch, even if
someone later edits the core. Share-token resolution stays in `/api/v1/compute`'s handler.

An unreachable definition returns **404, not 403**. A guid is guessable, so `requireCanSolve`'s 403
on this path would tell a caller whether a definition they cannot see exists. `/api/v1/compute`
keeps its 403 — its callers navigated to the definition rather than probing an id.

## Idempotency

The endpoint accepts an optional `Idempotency-Key`. A repeat within the TTL replays the first
response instead of solving again, and the replay carries `Idempotency-Replayed: true`.

**The store holds a promise, reserved before the solve starts.** The common case is a client
retrying while the first solve is still running, so the second request joins the first rather than
starting a second one. A rejected reservation is dropped, so a failed solve stays retryable instead
of replaying an error for the whole TTL. The key is namespaced by caller — `Idempotency-Key` is
client-chosen, so two tenants can pick the same string.

This absorbs retries; it is not a result cache. The TTL is a fixed 5 minutes, and the store is
**per-process** — correct for a single-instance deployment, useless the day a second one runs.

New in `@selvajs/server/compute`: `createIdempotencyStore`, `DEFAULT_IDEMPOTENCY_MAX_KEYS`, and the
`IdempotencyStore` / `IdempotencyStoreConfig` / `IdempotencyOutcome` types. Bounded and timer-free
(amortized sweep plus a hard cap, driven by the call path) so the module has no lifecycle its
callers lack.

## The contract is generated and enforced

`packages/selva/openapi/v1.yaml` describes every v1 endpoint — auth schemes, pagination, the full
`ApiErrorCode` enum, `x-internal` tags. Regenerate with `pnpm openapi:generate`; `pnpm test` fails
when the committed file drifts from the code.

**Request schemas are derived from the actual Zod validators** via `z.toJSONSchema` (Zod 4 emits
JSON Schema natively, so there is no `zod-openapi` dependency), which meant moving them somewhere a
generator can import: `$lib/server/api/v1/bodies.ts`. Hand-transcribing them would have reproduced
exactly the shape drift the spec exists to catch. Response schemas are deliberately **not** derived
— handlers build payloads from store records with no validator on the way out, so the envelopes are
described precisely and individual resource bodies left open rather than claiming precision that
does not exist.

A conformance test enforces the contract rather than its existence: method+path parity in both
directions, no bare `error(...)` anywhere in the tree, every collection paginating through the
shared parser, no documented 403 without a 404 on a guessable-id route, and a platform-permission
guard on every `/api/admin/**` handler. That last one matters because the `/admin` layout guard
never ran for endpoints — "all admin routes guard themselves" held only by review until now. The
assertions were verified by breaking them: a bare `error()`, a removed admin guard, and an
unregistered route each failed the suite by name.

`/docs/api` renders the public subset, filtered in the load function rather than the markup so
internal endpoints never reach the page payload. The spec itself is served at
`/docs/api/openapi.yaml`. Both are public — an API reference behind a login is hidden from the
people deciding whether to integrate.

## Every handler has the same shape

The route tree was 2070 lines in which the interesting part sat a few lines deep, and the
boilerplate had already drifted: path params were validated two ways (18 via `GuidSchema`, 13 via a
manual `if (!id)`), the `try { … } catch (handleApiError) }` tail appeared 59 times, and five upload
handlers each formatted their own "Max size: N MB".

Shared helpers now carry it — `apiRoute`, `requireCaller`, `requireParams`, `parseParam`,
`parseBody`, `requireUpload`, `formText`, `collection`, `created`, `noContent`, `shaped`. The tree
is 1825 lines with none of those patterns left.

Two of those cleanups were correctness fixes:

**Four list endpoints ignored documented query params.** Share links, versions, invites and project
members each hand-rolled the pagination clamp, and all four had drifted from `parseListOptions`:
they hardcoded the default limit, dropped `Math.trunc` (so `limit=5.9` reached the store), and
silently ignored the `orderBy`/`orderDir` the spec documents them as accepting. They now honour
both. A conformance assertion rejects an inline clamp on any endpoint the registry calls a
collection, so a fifth copy cannot be written.

**Secret stripping is structural rather than conventional.** `ShareLink.tokenHash`,
`Invite.tokenHash` and `OrgComputeServer.apiKey` were removed by destructuring, which holds until
someone edits the line away or adds a field to the stored type — neither fails a build, and the
result is a credential in a response. Those payloads now parse through explicit response schemas, so
a new field on a stored record is invisible to clients until it is added deliberately.

`PATCH /api/v1/orgs/{orgId}/compute` was the last handler validating its body by hand; it is now a
Zod schema, so the spec derives that body too. Its `apiKey` stays `.nullable().optional()` and
deliberately not `.nullish()` — omitted keeps the stored key, `null` clears it, a string replaces
it, and collapsing the first two would wipe a live Rhino.Compute credential on any save that left
the field out.

`/docs/` joins the public route prefixes in `hooks.server.ts`.
