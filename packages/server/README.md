# @selvajs/server

Transport-agnostic server building blocks for apps built on the Selva engine: limits, rate
limiting, SSRF guard, definition service, render loader, and structured logging. Consumed by
`@selvajs/selva`; not tied to SvelteKit or any specific HTTP framework.

**The solve core lives in [`@selvajs/solve/server`](../solve/README.md)** — pipeline, result cache,
single-flight, client and definition-byte caches. This package does not re-export it and does
not depend on it. What stays here is HTTP _request policy_, which is a different job from running a
solve.

Logging follows the same rule as the rest of the package: nothing here logs unless you wire
it. Modules that emit diagnostics take an optional `logger?: ILogger` and default to
`NoopLogger`, so an embedder that wires nothing gets silence rather than unsolicited stdout
writes. `@selvajs/server/logging` provides a pino-backed implementation (`createLogger`);
`pino` is an **optional** peer dependency, and without it `createLogger` falls back to a
console-backed logger rather than failing.

## Install

```bash
pnpm add @selvajs/server
```

## Subpath exports

**There is no root export.** Import from a subpath — `import … from '@selvajs/server'` fails to
resolve, on purpose. A root barrel re-exporting all nine subpaths put 41 symbols in one namespace and
hid which slice a consumer actually depended on; nothing in this repo used it.

| Export                        | Contents                                                           |
| ----------------------------- | ------------------------------------------------------------------ |
| `@selvajs/server/compute`     | Compute limits, rate limiting, SSRF guard, remote-definition fetch |
| `@selvajs/server/definitions` | Definition service + render loader                                 |
| `@selvajs/server/providers`   | Provider composition helpers                                       |
| `@selvajs/server/tokens`      | Mints and verifies personal API tokens                             |
| `@selvajs/server/errors`      | Shared error types                                                 |
| `@selvajs/server/logging`     | pino-backed `ILogger` + request-id correlation                     |
| `@selvajs/server/http`        | Security headers, request limits, route classification             |
| `@selvajs/server/access`      | Access/permission checks                                           |
| `@selvajs/server/ops`         | Operational utilities                                              |

Requires a `@selvajs/platform` provider (e.g. `@selvajs/local-provider` or
`@selvajs/supabase-provider`) for data/storage/auth.

See the root [CLAUDE.md](../../CLAUDE.md) for how this package fits into the wider Selva
architecture.
