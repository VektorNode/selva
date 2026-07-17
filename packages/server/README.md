# @selvajs/server

Transport-agnostic compute/solve/definitions server building blocks for apps built on the
Selva engine: limits, rate limiting, SSRF guard, input transform, solve pipeline, definition
service, render loader, and structured logging. Consumed by `@selvajs/selva`; not tied to
SvelteKit or any specific HTTP framework.

Logging follows the same rule as the rest of the package: nothing here logs unless you wire
it. Modules that emit diagnostics take an optional `logger?: ILogger` and default to
`NoopLogger`, so an embedder that wires nothing gets silence rather than unsolicited stdout
writes. `@selvajs/server/logging` provides a pino-backed implementation (`createLogger`);
`pino` is an **optional** peer dependency, and without it `createLogger` degrades to a
console-backed logger rather than failing.

## Install

```bash
pnpm add @selvajs/server
```

## Subpath exports

| Export                        | Contents                                                |
| ----------------------------- | ------------------------------------------------------- |
| `@selvajs/server`             | Root — package entry point                              |
| `@selvajs/server/compute`     | Solve pipeline, SSRF guard, Rhino.Compute client wiring |
| `@selvajs/server/definitions` | Definition service + render loader                      |
| `@selvajs/server/providers`   | Provider composition helpers                            |
| `@selvajs/server/tokens`      | API token (PAT) codec                                   |
| `@selvajs/server/errors`      | Shared error types                                      |
| `@selvajs/server/logging`     | pino-backed `ILogger` + request-id correlation          |
| `@selvajs/server/http`        | Rate limiting, security headers, request limits         |
| `@selvajs/server/access`      | Access/permission checks                                |
| `@selvajs/server/ops`         | Operational utilities                                   |

Requires a `@selvajs/platform` provider (e.g. `@selvajs/local-provider` or
`@selvajs/supabase-provider`) for data/storage/auth.

See the root [CLAUDE.md](../../CLAUDE.md) for how this package fits into the wider Selva
architecture.
