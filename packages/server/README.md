# @selvajs/server

Transport-agnostic server building blocks for apps built on the Selva engine: limits, rate
limiting, SSRF guard, definition service, render loader, and structured logging. Consumed by
`@selvajs/selva`; not tied to SvelteKit or any specific HTTP framework.

**The solve core lives in [`@selvajs/solve/server`](../solve/README.md)** — pipeline, result cache,
single-flight, client and definition-byte caches. This package does not re-export it and does
not depend on it. What stays here is HTTP _request policy_, which is a different job from running a
solve.

Nothing here logs unless you wire it. Modules that emit diagnostics take an optional
`logger?: ILogger` defaulting to `NoopLogger`, so an embedder that wires nothing gets silence
rather than unsolicited stdout writes. `@selvajs/server/logging` provides a pino-backed
`createLogger`; `pino` is an **optional** peer dependency, and without it `createLogger` falls
back to a console-backed logger rather than failing.

## Install

```bash
pnpm add @selvajs/server
```

## Subpath exports

**There is no root export.** Import from a subpath — `import … from '@selvajs/server'` fails to
resolve, on purpose, so it stays visible which slice a consumer depends on.

| Export                        | Contents                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `@selvajs/server/compute`     | Compute limits, rate limiting, idempotency, SSRF guard, remote-definition fetch |
| `@selvajs/server/definitions` | Definition service, compute-schema extraction, render loader                    |
| `@selvajs/server/providers`   | Env-driven provider selection over a caller-supplied registry                   |
| `@selvajs/server/tokens`      | HMAC codec for capability-URL tokens (share links, invites)                     |
| `@selvajs/server/errors`      | Sentry-backed `IErrorReporter`                                                  |
| `@selvajs/server/logging`     | pino-backed `ILogger` + request-id correlation                                  |
| `@selvajs/server/http`        | Security headers, body-size and redirect guards, route classification           |
| `@selvajs/server/access`      | Builds the input platform's project access rules consume                        |
| `@selvajs/server/ops`         | Channel-aware semver comparison                                                 |

Requires a `@selvajs/platform` provider (e.g. `@selvajs/local-provider` or
`@selvajs/supabase-provider`) for data/storage/auth.
