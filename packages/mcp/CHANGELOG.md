# @selvajs/mcp

## 0.1.0-beta.7

### Minor Changes

- a723f1a: Telemetry seams a host wires once: error reports that group and scrub, request and upstream timing, and MCP tool-call records.

  - `@selvajs/platform`: `ErrorContext` takes `level` (`fatal`, `error`, `warning`) and `kind`, which groups reports of one fault whose message varies.
  - `@selvajs/server/errors`: `scrubEvent`, `scrubBreadcrumb`, `withoutQuery` and `sampleRate` keep cookies, auth headers, bodies, query strings and anything but a user's id out of Sentry-shaped events, server or browser, without importing Sentry. `SentryErrorReporter.create` installs them and takes `tracesSampleRate`. `SentryErrorReporter.fromClient` wraps an SDK the host initialized itself, such as a framework SDK that also traces requests. `capture` sends `level`, tags `kind`, and fingerprints by it.
  - `@selvajs/server/http`: `createRequestTiming` times a request's spans and every outbound fetch by upstream, stamps `Server-Timing`, and logs a `[timing]` record for a slow, sampled (`sampleRate`, default 0.1) or first request, with each upstream's call count, total, median and max. The first request also logs `[coldstart]` with the boot time `markBooted` recorded. Every record carries a per-process `instance` and the host's `labels`.
  - `@selvajs/supabase-provider`: `supabaseUpstream` names a Supabase call's service (`db`, `auth`, `storage`) and table or RPC for `createRequestTiming`.
  - `@selvajs/server/api`: an endpoint with `longRunning` (it runs Compute without the `solve` scope) is emitted with `x-long-running`.
  - `@selvajs/mcp`: an `x-long-running` operation gets `solveTimeoutMs`, not the default timeout. `ApiClientOptions.onCall` is told of each settled call (operation, status, error code, attempts, duration). `McpServerOptions.onToolCall` is told of each tool call: outcome (`ok`, `error`, `timeout`, `invalid_arguments`), the API calls it made, argument names with their sizes, never values, and the response size.
  - `@selvajs/selva`: requests are timed through `createRequestTiming`, MCP tool calls log an `[mcp]` record, and `SENTRY_TRACES_SAMPLE_RATE` sets Sentry's trace sampling. Sentry events are scrubbed before they leave.

## 0.1.0-beta.6

### Patch Changes

- a409b68: A new API scope action, `create_projects`: create private projects that nobody joins on upload, org-wide only. `write` includes it. `POST /projects` now asks for it, so a 403 there names `create_projects:org:<id>` instead of `write:`. The built-in Grasshopper OAuth client may request it; registered clients can't. A key holding it may be held by anyone who may create a project in the org, so an org admin with no projects can sign in the plugin.

  Creating a project checks the same visibility rules as `PATCH`: only org owners and admins create public projects. Project creation through API keys has a per-owner limit (20 an hour by default, `projectCreateLimiter` in deps). `GET /me` returns `capabilities.createProjects`. `DELETE /me/token` works for a key whose owner no longer qualifies to hold it.

  Upload to Selva in the plugin: the connection moves to its own dialog, Upload shows only for a key Selva accepted in this Rhino session, the first connection to an instance is confirmed in Rhino, a pasted key is refused as an address, and an upload can go into a new private project.

## 0.1.0-beta.5

### Minor Changes

- 69ff76a: - **Breaking:** OAuth consent offers and mints a key only in the session's acting org. `consentOrgs` returns at most that org and `mintConsentToken` refuses any other, since the token page can list and revoke keys only there.
  - `readForm` parses a request's form body once. The idempotency fingerprint and the upload handlers share it, so a definition upload is no longer buffered and parsed twice. On an idempotent route, read forms through it: `request.formData()` throws once the fingerprint has used the body.
  - The CSRF exemption reads the bearer as `resolveApiToken` does, so `Bearer selva_x extra` no longer skips the Origin check.
  - OAuth codes are opened with a fixed 16-byte GCM tag.
  - `@selvajs/mcp` exports `refuseEarly`, the origin and key checks `handle` runs first. Selva's `/mcp` runs it against the configured origins before building a server, so neither an anonymous request nor a page on a rebound name can trigger a build.
  - Step sizes count decimals at 15 significant digits: `16384.2` gets a step of 0.1, not 1e-12.

## 0.1.0-beta.4

### Patch Changes

- 65786d5: API tokens have a fourth action, `upload`: creating definitions, uploading versions, making a version live and previewing a file's schema, and nothing else. `upload` includes `read`, and `write` includes `upload`; `apiScopeActionCovers` says which action covers which. `canCreateDefinition` is the rule for adding a definition to a project. Definitions carry `sourceDocumentId`, the Grasshopper document GUID of the last upload that had one, and `DefinitionListOptions.sourceDocumentId` filters by it in the store query.

  **Breaking:** `narrowApiTokenContext` takes the token's `expiresAt`, and `ctx.apiScope` carries it.

## 0.1.0-beta.3

### Minor Changes

- 873470a: - Built on `@modelcontextprotocol/server` v2: `handle` serves protocol `2026-07-28` and, statelessly, 2025-era clients. `tools/list` carries a five-minute private cache hint.
  - `handle` answers 403 to a request whose `Origin` is neither the host's nor in the new `allowedOrigins` option.
  - An unknown tool, resource or prompt is a JSON-RPC `-32602` error, not a tool result.
  - New `grantedActions(api)` option: `tools/list` leaves out tools the request's key can't use, and calling one returns 403 with an `insufficient_scope` challenge naming every scope the tool needs. A 401 from the hook becomes a 401 with `error="invalid_token"`.
  - New `challenge` option adds `resource_metadata` and `scope` to the 401 and 403 challenges, for OAuth clients.
  - Tools and `fromOperation` take `output` (Zod or JSON Schema), listed as `outputSchema`.

## 0.1.0-beta.2

### Minor Changes

- ef94b55: - `handle` answers 401 to a bearer that isn't a Selva API key (`selva_…`), and API calls send `credentials: 'omit'`. A host whose `fetch` forwards the incoming request's cookies can no longer run tools as the browser session.
  - `handle(request, { fetch })` takes a per-request `fetch`, so a host can build the server once and still use a request-bound fetch.
  - `idempotentHint` is set only when every call is a GET, PUT or DELETE. Accepting an `Idempotency-Key` makes a retry safe, not a repeat tool call.

## 0.1.0-beta.1

### Minor Changes

- 80a7ed1: **Breaking:** `handle(request)` answers as the request's own `Authorization: Bearer` key and never the configured `apiKey`, which only `listen` and `verify` use; a request without a key gets 401 with `WWW-Authenticate: Bearer`. Before, every HTTP caller ran as the server's key. `apiKey` is now optional: a host serving only HTTP drops it, and can stop parsing the bearer itself.
- 80a7ed1: A tool can return pictures: `ToolOutput.images` (`{ data, mimeType }`, base64) go out as MCP image content after the text, for a model that can see. Clients render PNG, JPEG, GIF and WebP, not SVG.

## 0.1.0-beta.0

### Minor Changes

- 075919c: New `@selvajs/mcp`: serve a host's `/api/v1` as MCP tools over stdio or streamable HTTP, with key auth, error mapping, 429 handling and annotations from the spec.

  `@selvajs/server/api` exports `buildOpenApiDocument(endpoints, options)` and the `Endpoint` type, so every host publishes the same spec shape. `Endpoint.scope` is required and emitted as `x-scope`.

  Selva serves `GET /api/v1/openapi.json` and an MCP endpoint at `/mcp`: send an API key as `Authorization: Bearer <key>`. Tools: `selva_list_projects`, `selva_list_definitions`, `selva_describe_definition`, `selva_solve`.
