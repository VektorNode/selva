---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/supabase-provider': minor
'@selvajs/mcp': minor
'@selvajs/selva': patch
---

Telemetry seams a host wires once: error reports that group and scrub, request and upstream timing, and MCP tool-call records.

- `@selvajs/platform`: `ErrorContext` takes `level` (`fatal`, `error`, `warning`) and `kind`, which groups reports of one fault whose message varies.
- `@selvajs/server/errors`: `scrubEvent`, `scrubBreadcrumb`, `withoutQuery` and `sampleRate` keep cookies, auth headers, bodies, query strings and anything but a user's id out of Sentry-shaped events, server or browser, without importing Sentry. `SentryErrorReporter.create` installs them and takes `tracesSampleRate`. `SentryErrorReporter.fromClient` wraps an SDK the host initialized itself, such as a framework SDK that also traces requests. `capture` sends `level`, tags `kind`, and fingerprints by it.
- `@selvajs/server/http`: `createRequestTiming` times a request's spans and every outbound fetch by upstream, stamps `Server-Timing`, and logs a `[timing]` record for a slow, sampled (`sampleRate`, default 0.1) or first request, with each upstream's call count, total, median and max. The first request also logs `[coldstart]` with the boot time `markBooted` recorded. Every record carries a per-process `instance` and the host's `labels`.
- `@selvajs/supabase-provider`: `supabaseUpstream` names a Supabase call's service (`db`, `auth`, `storage`) and table or RPC for `createRequestTiming`.
- `@selvajs/server/api`: an endpoint with `longRunning` (it runs Compute without the `solve` scope) is emitted with `x-long-running`.
- `@selvajs/mcp`: an `x-long-running` operation gets `solveTimeoutMs`, not the default timeout. `ApiClientOptions.onCall` is told of each settled call (operation, status, error code, attempts, duration). `McpServerOptions.onToolCall` is told of each tool call: outcome (`ok`, `error`, `timeout`, `invalid_arguments`), the API calls it made, argument names with their sizes, never values, and the response size.
- `@selvajs/selva`: requests are timed through `createRequestTiming`, MCP tool calls log an `[mcp]` record, and `SENTRY_TRACES_SAMPLE_RATE` sets Sentry's trace sampling. Sentry events are scrubbed before they leave.
