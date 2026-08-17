---
'@selvajs/selva': patch
---

Admin routes adopt the shared HTTP wrapper, and two conformance tests keep both surfaces honest.

`/api/admin/*` had zero of 22 handlers using `apiRoute`, against 40 of 43 in v1.
That was drift rather than design, and the cause was the file path: the helpers
lived at `api/v1/route.ts`, and a helper under a version prefix reads as
belonging to that version. So the sibling surface hand-rolled `if (!id)
apiError(400, …)` and a per-handler `try/catch` instead. Nothing in those helpers
was ever v1-specific; they now live at `api/http.ts`, with `api/v1/route.ts` left
as a re-export so existing importers are untouched.

**Two inner catches were kept deliberately.** `apiRoute` re-throws anything
already structured, so a `apiError(409, …)` passes straight through — which means
a `catch` mapping `ProviderError.statusCode === 409` to a typed conflict is doing
real work. A blanket "remove every try/catch" sweep would have turned two clean
409s into 500s. The compute routes keep theirs too: they log deliberately and
return a specific 500. Only the `catch (err) { handleApiError(err, '…') }` tail
that `apiRoute` now owns was deleted.

Streaming and SSE handlers stay unwrapped on purpose — once the status line is
sent a wrapper cannot change the response, so `apiRoute` has nothing to offer
them and wrapping them would imply it does.

Two new conformance checks, because nothing had ever pinned either fact:

- **Every route handler is wrapped**, generated per route/method across both
  surfaces. The exemption list for streaming handlers has its own test: an
  exemption naming a route that no longer ships fails, so a stale exemption
  cannot silently excuse nothing.
- **Every shipped route appears in the Permissions.md §8 matrix.** Deliberately
  one-directional — a row with no route is fine, since §8 documents unbuilt
  endpoints on purpose; only shipped-but-unlisted fails. It found 16 routes with
  no row, two rows whose path never matched a real route
  (`/api/v1/compute/solve` does not exist), and one naming the wrong permission
  (`/api/admin/system/update` was documented as `manage_updates`; the code
  requires `instance_admin`).

Also documents `ADDRESS_HEADER` / `XFF_DEPTH` in `.env.example`. Both are read by
`@sveltejs/adapter-node`, but the login and email-sign-in rate limiters key on
`getClientAddress()` — behind a proxy that is the proxy's own IP for every
request, so one noisy client can lock out the whole deployment and no per-IP
limit means anything.
