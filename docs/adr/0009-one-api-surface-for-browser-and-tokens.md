# ADR 0009: One Versioned API Surface for the Browser and API Tokens

> **Status: Accepted (2026-08-16), recorded 2026-11-17.**

## Problem

API tokens need a stable HTTP contract. The app's `/api/*` endpoints had grown as a browser
mutation API: reads lived in page load functions, and naming and method semantics were
inconsistent. Freezing that shape behind `/api/v1` wrappers would have meant two URL trees, one
of them untested by the app's own UI.

## Decision

`/api/v1/*` is the one API, used by the browser UI and by API tokens alike. The app's own pages
call it, so every endpoint a token can reach is exercised by the UI.

Stability is declared per endpoint in the OpenAPI spec (`packages/selva/openapi/v1.yaml`):
`x-internal` marks an endpoint the UI uses but external callers must not rely on. There is no
second, "public" URL tree.

Every endpoint shares one error envelope: `{ message, code, fields?, details?, requestId }`, with
`code` from `ApiErrorCode` (`@selvajs/server/api`). Responses carry `Cache-Control: private,
no-store`.

## Consequences

- A breaking change to a public endpoint is a `/api/v2` decision, even when only the UI needed it.
  Mark an endpoint `x-internal` while its shape is still moving.
- Route handlers parse, guard, delegate and serialize. A rule two endpoints share lives in
  `@selvajs/server`, not in both handlers.
- Reads the UI once did in load functions had to be written as endpoints. That cost was paid once,
  when the surface was built.
