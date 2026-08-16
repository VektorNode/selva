# API v1 residuals

**Tracked in [#201](https://github.com/VektorNode/selva/issues/201).**

Four items left over from [api-redesign-plan](../archive/api-redesign-plan.md), which shipped
Phases A–E and was archived 2026-08-16. Each is small and independent; none blocks the others.

They are filed here rather than in the archived plan because
[token-plan](../features/token-plan.md) hits all four — PAT auth needs the 429 code for
per-token rate limiting, and the `Cache-Control` header matters more once responses are
machine-fetched.

## 1. `429` is documented but not expressible

`v1.yaml` documents 429 responses, but `ApiErrorCode`
(`packages/selva/src/lib/server/api-errors.ts`) has nine codes and no `RATE_LIMITED`;
`codeForStatus` has no 429 case. A handler that rate-limits cannot return a typed code for it.

Add `RATE_LIMITED` to the enum and the `codeForStatus` map.

## 2. `requestId` is header-only

`App.Error` (`packages/selva/src/app.d.ts`) is `{message, code?, fields?, details?}`. The request
id is set as a response header in `hooks.server.ts` but never lands in the JSON body, so a client
logging a failed response body has nothing to quote back to an operator.

Add `requestId` to `App.Error` and populate it where the error envelope is built.

## 3. No `Cache-Control` on v1 GETs

Nothing sets `private, no-store`. Authenticated JSON is currently cacheable by any intermediary
that decides to. Declared open in the original plan and never done.

## 4. No ADR for the single-surface decision

`docs/adr/` runs 0001–0007 with nothing on API v1. The decision worth recording is the one in the
archived plan's opening: one versioned surface for both browser and tokens, rather than
`/api/v1` wrappers over a browser-shaped API, with per-endpoint stability expressed as
`x-internal` in the OpenAPI spec.
