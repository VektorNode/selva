# @selvajs/server

Transport-agnostic compute/solve/definitions server building blocks for apps built on the
Selva engine: limits, rate limiting, SSRF guard, input transform, solve pipeline, definition
service, and render loader. Consumed by `@selvajs/selva`; not tied to SvelteKit or any
specific HTTP framework.

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
| `@selvajs/server/http`        | Rate limiting, security headers, request limits         |
| `@selvajs/server/access`      | Access/permission checks                                |
| `@selvajs/server/ops`         | Operational utilities                                   |

Requires a `@selvajs/platform` provider (e.g. `@selvajs/local-provider` or
`@selvajs/supabase-provider`) for data/storage/auth.

See the root [CLAUDE.md](../../CLAUDE.md) for how this package fits into the wider Selva
architecture.
