# Triggers

A trigger starts a solve of one definition from outside Selva: an HTTP call from any tool that can
send one, or a schedule. That covers no-code platforms (n8n, Make, Zapier, Power Automate), SaaS
webhooks (Notion, GitHub, Stripe, Slack and the like), an ERP, or a script. The trigger maps the
incoming payload onto the definition's inputs.

This covers the **input side only**. Outputs have no data types yet (see
[Output side](#output-side-deferred)), so a trigger stores a run record you can fetch instead of
pushing a typed result anywhere. Outbound delivery is [webhooks.md](./webhooks.md); the two meet
when outputs are typed.

## The line that keeps it flexible and safe

A trigger is one strict step in someone else's chain, not a workflow engine. It has to fit behind
any sender and in front of any consumer without Selva learning about either.

- **Everything a trigger is configured with is data:** who may call it (a
  [sender profile](#sender-profiles)) and which payload field feeds which input (the
  [mapping](#input-mapping)). A new sender is a new profile, not new code.
- **Both edges speak published standards.** In: JSON over HTTPS, described by JSON Schema and
  OpenAPI generated from the definition's contract. Out: Standard Webhooks signatures, the scheme
  [webhooks.md](./webhooks.md) signs with. Whatever sits in front or after works with stock
  libraries and import tools.
- **Logic lives outside.** Branching, enrichment, fan-out over rows, calls to third parties and
  retries against them belong in the tool in front or after, which is built for it.
- **Nothing a sender or an editor configures is executed.** No expressions, no scripts, no outbound
  fetches in v1. This is what makes the flexibility safe: a trigger's attack surface is a verifier,
  a small parser and a lookup table.

## Decisions

### A trigger belongs to one definition

- **One row per trigger,** scoped to a definition. It follows the definition's **live version**, so
  publishing a new version needs no re-wiring.
- **It runs as a service account** ([service-accounts.md](./service-accounts.md)), not as whoever
  created it. A trigger must outlive the person who set it up. Service accounts are a plan only: no
  table or code exists yet, and `api_tokens` still has `user_id` equal to `created_by`. Triggers
  ship after them, or first run as the creator with the lifecycle caveat stated in the UI.
- **The run principal is rebuilt on every run, when the run is claimed.** It goes through the same
  owner check `resolveApiToken` runs (not disabled, still a member, still allowed to hold
  credentials). `narrowApiTokenContext` then narrows the live context to `solve:definition:<guid>`,
  and a delegated session is minted for row security. That check moves out of `resolveApiToken` into
  one function both call, because a copy would drift. A principal that fails it pauses the trigger
  as `broken`; a run never falls back to anyone else.
- **Creating one needs the right to edit the definition, and grants nothing.** The run principal
  must already be able to solve the definition. The trigger only narrows what it has, so it can
  start solves the creator could start, nothing more.
- **A pinned version is trusted config, not a caller's choice.** `runSolve` treats an explicit
  `versionId` as editor-only, and a service account with `solve` must not gain edit rights to get
  past that. An editor authorizes the pin when saving it, and the run hands it to the solve core as
  the trigger's version policy (`live` or `pinned`).

### Endpoint and auth

- **`POST /api/hooks/{triggerId}`.** One endpoint, `application/json` bodies only (`415` otherwise).
  Not an `/api/v1` route: `/api/v1` authenticates a user or token and returns the full envelope.
  This one authenticates a trigger and answers with the minimum, because the caller is a third-party
  tool.
- **It is a self-gating route.** The classifier in `hooks.server.ts` is deny-by-default, so
  `/api/hooks/` goes into `selfGatingPrefixes`. `application/json` isn't a form type, so
  `isCrossSiteFormSubmission` leaves it alone with no exemption. No CORS headers: the callers are
  servers.
- **The order of checks is fixed,** and each step runs before anything that costs more: refuse a
  secret in the query string, check content type and declared size, authenticate, read the body
  under a cap, parse, apply rate and concurrency caps, resolve inputs, enqueue.
  - **Bearer mode authenticates from the header before the body is read,** so an unauthenticated
    sender never gets Selva to buffer anything.
  - **Signature mode has to read the body to verify it,** so the read is capped while streaming.
    `requireMaxBodySize` checks only `Content-Length`: a chunked body skips it and falls through to
    `BODY_SIZE_LIMIT`, which is sized for definition uploads. `readBodyWithCap` already counts bytes
    as they arrive; it moves from `compute/remote-definition.ts` to `@selvajs/server/http` and
    learns to read a request.
- **Two auth modes,** set by the trigger's [sender profile](#sender-profiles):
  - **`bearer`** (default): `Authorization: Bearer selvahook_…`. For n8n, Make, Zapier, Power
    Automate, scripts, and anything else that can set a header. Built on `createTokenCodec`: shown
    once, stored as `HMAC(SELVA_HMAC_KEY, secret)`. The `selvahook_` prefix lets secret scanners
    match it. It must not start with `selva_`: the request hook resolves every `selva_` bearer as
    an API token before any route runs, and refuses it outside `/api/v1/`.
  - **`signature`**: the sender signs the request with a shared secret and Selva verifies it. For
    senders that sign but can't set a custom header. Verifying an HMAC needs the secret itself, so
    it **can't be hashed**. It is encrypted at rest with `encryptSecret` and `SELVA_AT_REST_KEY`, the
    same envelope compute API keys use, and decrypted only to verify. A second user moves that
    envelope out of `@selvajs/platform/computeServer` into a neutral module.
- **No secret in the URL.** A key in the query string ends up in access logs, proxies and referrer
  headers. A `selvahook_` value in the query is refused with a message to rotate it, the way
  `resolveApiToken` refuses a `selva_` one. A sender that can neither set a header nor sign can't
  call a trigger directly; put n8n or any relay in front.
- **Verification rules, both modes:** constant-time comparison; verify over the raw request bytes,
  before any JSON parsing, since re-serialized JSON changes the bytes. A scheme with a timestamp
  rejects anything more than five minutes off, in either direction. A scheme without one relies on
  the dedupe in [Execution](#execution), which only holds as long as the run row exists, so run
  retention has a floor (see [Storage](#storage)).
- **Rotation keeps two secrets live, briefly.** The previous secret carries an expiry, a day by
  default. Without one, a rotated-away secret would stay valid forever.
- **Authenticate, then reveal state.** An unknown trigger and a wrong secret return the same `401`,
  so the endpoint can't be used to enumerate trigger ids. Ids are random uuids, so this is defence
  in depth rather than the only barrier. Only a caller who proved the secret learns that a trigger
  is disabled or paused (`409` with the status).

### Secrets and keys

- **Rotating `SELVA_HMAC_KEY` invalidates every bearer trigger secret,** as it does API tokens and
  share links. **Rotating `SELVA_AT_REST_KEY` makes every signing secret undecryptable,** as it does
  the compute API key. Either one breaks every external sender with no error on Selva's side, so
  `.env.example` and `selva keys rotate` name triggers in the change that ships them.
- **Signing secrets report through `verifySecrets()`,** the check compute servers already use, so a
  key mismatch reaches the admin health page instead of showing up as failed deliveries.

### Sender profiles

A sender profile answers four questions per trigger. It is data on the trigger row, validated by a
Zod schema. Presets are rows in one table, not branches in code, and a custom profile fills in the
same fields.

| Field        | What it says                                                                                                    | Examples                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `auth`       | `bearer`, or `signature`: header, encoding (hex or base64), value prefix, and which parts are signed, in order  | `sha256=<hex>` over the body; `v1,<base64>` over `{id}.{ts}.{body}` |
| `timestamp`  | Where a signed timestamp comes from, if anywhere: a header, a field in the signature header, a path in the body | `webhook-timestamp`; `t=` in a composite header                     |
| `deliveryId` | Where the sender's per-delivery id comes from: a header or a path in the body                                   | `Idempotency-Key`; `webhook-id`; an event `id` in the body          |
| `handshake`  | The one-time exchange some senders do when the URL is registered                                                | echo a challenge; capture a verification token                      |

**Presets** cover the schemes senders actually use. Each one ships with a test vector taken from the
vendor's own docs, because a preset that verifies nothing is worse than none:

- **Bearer** (n8n, Make, Zapier, Power Automate, scripts): `deliveryId` from `Idempotency-Key`, the
  header the solve endpoint already honours.
- **Standard Webhooks** (Svix and services built on it, and Selva's own outbound webhooks, so one
  Selva can trigger another).
- **Body HMAC with a vendor header** (`X-Hub-Signature-256` for GitHub, `X-Notion-Signature` for
  Notion, `X-Shopify-Hmac-Sha256` for Shopify). There is no timestamp header, but the signed body
  often carries one, and the preset points `timestamp` at it where it does.
- **Timestamped HMAC** (Stripe's `t=…,v1=…`, Slack's `v0:{timestamp}:{body}`).

**Handshakes** are where an unauthenticated request touches a trigger, so they stay narrow. They are
matched first, and only when the profile declares one:

- **Echo** (Slack's `url_verification`, Microsoft Graph's `validationToken`): the response returns
  the challenge value as `text/plain`, capped in length and charset. Nothing is stored.
- **Capture** (Notion posts a `verification_token` once; the user pastes it back into Notion, and
  it signs every later delivery): an editor arms the capture from the trigger page, it stays open
  for a few minutes, and it accepts only the handshake's shape. The token becomes the signing secret
  only when the editor confirms it. If more than one arrives, the page shows them all; an injected
  token fails the sender's own verify step, so the editor sees that before anything depends on it.

### Input mapping

- **The mapping is data, keyed by input id,** not code, with an explicit mode:

  ```json
  {
  	"v": 1,
  	"mode": "map",
  	"inputs": {
  		"<inputId>": { "from": "$.page.properties.Width.number" },
  		"<inputId>": {
  			"from": "$.size",
  			"lookup": { "S": "small", "L": "large" },
  			"default": "small"
  		},
  		"<inputId>": { "value": 2400 }
  	}
  }
  ```

  `from` is a JSONPath into the body and `value` is a constant. `default` applies when the path
  finds nothing. `lookup` is a table from sender values to input values, for the common case of a
  no-code tool sending a select label where the definition expects a value-list option. An input
  with none of these takes the definition's default.

- **In `map` mode the sender controls exactly the inputs with a `from`.** Everything else is a
  constant or the definition default, whatever the body contains. This makes the mapping a security
  boundary: a public form behind Zapier can't reach an input the editor didn't expose.
- **`passthrough` mode is for callers that already speak Selva:** a body of the form
  `{ "inputs": { "<inputId>": value } }`, through the same validation. Scripts and n8n, which can
  shape JSON freely, need no mapping at all. It is chosen explicitly and never inferred from an
  empty mapping, because it hands the sender every mappable input, and clearing a mapping must not
  widen it. An optional `allow` list narrows which inputs it may set.
- **JSONPath is a restricted subset:** property access, array index and wildcard, evaluated by a
  small in-repo function. No JSONPath dependency exists in the repo, and the subset is small enough
  that one would add more surface than it saves. No filter or script expressions, so a mapping can't
  execute code or be written to burn CPU. Paths and lookups read own properties only
  (`Object.hasOwn`), so `__proto__` or `constructor` resolves to nothing. Nesting depth, key count,
  body size and a wildcard's result count are capped before or during evaluation.
- **No expression language.** Anything beyond picking, defaults and lookup tables (arithmetic, string
  joins, conditionals) belongs in the sender's own tooling, which is built for it. A transform
  language here would be a second product to maintain and a code-execution surface. This is the line
  that keeps the system small without limiting what can be put in front of it: any tool that can
  emit JSON can drive a definition.
- **Thin payloads need an enrichment step in front.** Many event webhooks carry ids and an event
  type, not the record: Notion's carries the page id, not its properties. A trigger mapped straight
  to such a sender can only supply what the event carries. To drive a definition from the record
  itself, put n8n (or any fetch-then-forward tool) between them: it receives the event, reads the
  record, and posts flat JSON to the trigger. A fetch step inside Selva would need stored third-party
  credentials and an outbound HTTP surface; it is not in v1.
- **Values are coerced and validated against the contract:** `ParamType`, min/max, value-list
  options. `"12"` becomes `12` for a number; `"abc"` fails. Failure is a `failed` run with the input
  id and reason, never a partial solve with a silent default. An out-of-range number fails here too,
  where the solve pipeline would quietly clamp it, and only to bounds the caller itself sent.
- **Keyed by input id so the mapping is checkable** against any version's contract. What happens
  when the live version changes is in [Versions and migration](#versions-and-migration).
- **Typed ports will grow into this.** When inputs gain a `dataType`, the mapping gets a type check
  at save time instead of at run time. The mapping shape does not change.

### Typing inputs from the stored schema

The input contract already exists: every version caches the schema Grasshopper reported at upload,
and its `inputs` list (`SchemaInput`: `id`, `nickname`, `paramType`, `default`, `inputStructure`) is
what the trigger types against. No new discovery or plugin work.

- **The server derives the input list from the version's cached schema, never from the request.**
  `POST /definitions/{guid}/solve` currently accepts `inputs` from the body and passes them to the
  pipeline unchecked, including the bounds the tree builder clamps to and the nickname it addresses
  the parameter by. A trigger takes only values from the sender and looks the inputs up itself, so
  a sender can't name parameters the definition doesn't declare.
- **Derivation is pure; loading is separate.** `deriveContract(schema)` does no I/O and lives in
  `@selvajs/schemas` beside `getInputItems`, so the server, MCP and the mapper form all share it.
  `loadContract(versionId)` in `@selvajs/server/definitions` reads the schema and caches the result.
- **Read the schema through the render loader, not off the row.** A persisted schema can still be
  PascalCase (`Inputs`, no `inputs`) or an older format version; `createDefinitionLoader` and
  `assertCamelCaseSchema` repair or refuse those. A trigger that read the blob raw would see a
  definition with no inputs and fail every mapping as `broken`.
- **One contract drives everything:** runtime validation, the save-time mapping check, the mapper
  form and "test" action in the UI, and the definition's public documents
  ([Contract documents](#contract-documents-and-docs)). When outputs are typed, the same derivation
  gains the response half. Nothing built now is thrown away then.
- **`id` is the identity, `nickname` is a label.** Mappings key on the Grasshopper instance GUID
  because nicknames get renamed. Deleting and re-adding an input in Grasshopper creates a new GUID;
  the `broken` check catches that. Read [plugin-context.md](../../docs/contributing/plugin-context.md)
  for which GUID is stable before relying on it.
- **`paramType` is never validated upstream** (plugin-context.md, rule 4): a mis-cased or unknown
  value reaches the cached schema as saved. The validator is a closed table keyed on the exact
  `ParamType` values, and an input whose type isn't in it is unmappable, never coerced as text.
- **Types that map cleanly:** `number`, `integer`, `boolean`, `text`, `color`, `valueList` (value
  must be one of the options). `file` takes a URL (see open questions). `geometry`, `point`, `line`,
  `plane`, `dynamicValueList` and `generic` have no defined JSON form: `map` mode rejects them when
  the mapping is saved, and `passthrough` can't set them.
- **The effective input contract is `SchemaInput` plus its layout item.** The MCP tools already
  build it: `describeInputs` in `mcp/tools.ts` joins each input to its layout item by `paramId` and
  reads range, step, options and the display name from the widget config. That join moves into
  `deriveContract`, so MCP, triggers and the contract endpoint cannot disagree. MCP's tools are
  clients of the HTTP API, so they read `/contract` rather than re-deriving from `/schema`. The
  widget limits are what the published form already lets a person submit, so a trigger enforces
  them too.
- **Gap: Grasshopper's own bounds are not saved.** Slider min/max, value-list options and accepted
  file formats exist on the wire-only `DiscoveredInput`, and an input with no layout item has no
  bounds at all. Adding optional `minimum`, `maximum` and `options` to `SchemaInput` is additive, so
  old saved definitions stay valid, and it would make the contract independent of the layout. It
  needs a `schemaVersion` decision and a regenerate.

### Execution

- **Asynchronous by default.** The call validates, inserts a `pending` run, and answers `202` with
  `{ runId }`. Senders time out in seconds and retry; a solve can take far longer.
- **The run outlives the request, so it can't use the request's plumbing.** `runSolve` takes the
  `Request` and `App.Locals`, aborts on `request.signal`, and returns a `Response`. After a `202`
  that request is gone: its signal would cancel the solve, and the outcome has nowhere to go. So the
  core moves into a transport-free function (principal, definition, version policy, inputs, values,
  its own `AbortSignal`, returning a solve outcome). Both solve routes become adapters over it, and
  a trigger run is a third. Rate limits, Compute routing, caching, coalescing and metrics stay in
  the core, so a run gets them with no copy.
- **Runs are claimed with a lease.** The request that inserted a run starts it in-process at once
  and holds `claimed_until` while it solves. The tick (see [Schedules](#schedules)) reclaims expired
  leases, so a restart can't leave a run `running` forever. A reclaimed run is marked `failed` with
  `interrupted`, not re-run: a definition can have side effects outside Selva (file writes, plugin
  calls), so a second solve isn't free.
- **`?wait=<seconds>`** (capped below the solve deadline) holds the response for callers that want
  the result inline, and falls back to `202` if the solve is not done. A held request counts toward
  the trigger's concurrency cap.
- **The caller polls with the secret it already has:** `GET /api/hooks/{triggerId}/runs/{runId}`,
  with the trigger's bearer. A sender holds a hook secret, not an API token, so a status read under
  `/api/v1` alone would leave it no way to get its result. A run id from another trigger reads as
  `404`. Signature-mode senders don't poll; their result goes out through a callback once outputs
  are typed.
- **Duplicate deliveries are expected.** Senders retry. A run is deduplicated on the sender's
  delivery id, from wherever the profile says, through the unique key on `trigger_runs` (see
  [Storage](#storage)). The id is length-capped. A replayed signed request inside the timestamp
  window is a duplicate, not a second solve.
- **No id, no dedupe.** A body hash would also swallow a deliberate repeat, such as the same payload
  every night. The UI tells the editor when a profile has no delivery id.
- **Abuse limits, all enforced before the solve:** body size cap; per-trigger rate limit and
  concurrency cap; failed-auth throttling per client address; a trigger that fails repeatedly is
  paused with a reason (`broken`, `failing`) instead of retrying forever. Throttling uses
  `getClientAddress`, like the login limiter, and has the same weakness: behind a reverse proxy that
  forwards no address, every sender shares one bucket.
- **Limits are process-local by default.** They go through `ApiRateLimiter`, so N instances admit N
  times the rate. A host that needs one budget plugs in a shared store, as for API tokens.
- **A run costs its principal's compute bucket, not the org's.** The solve core charges
  `user:{id}`, so every trigger running as one service account shares one bucket. That feeds
  [which service account](#open-questions).
- **A trigger has an on/off switch** that takes effect on the next request. Deleting the definition
  deletes its triggers through the foreign key, with `trigger.deleted` emitted. A definition losing
  its live version pauses them as `broken`.

### Schedules

- **A trigger may carry a cron expression instead of, or as well as, an endpoint.** A scheduled run
  uses constant `value` inputs only; there is no payload.
- **Cron runs in a stored IANA time zone** (`cron_tz`, the org's by default), so "weekdays at 07:00"
  stays local across daylight-saving changes.
- **The engine ships `createTriggerRunner({ store, solve, now })` with a `tick()`,** and the host
  decides when to call it. `solve` is the transport-free core, injected, because it lives in the app
  and the engine doesn't run solves of its own. Same shape and reasoning as the webhook dispatcher:
  no module-level timer, and multi-instance safe by claiming due rows with `for update skip locked`
  on Supabase. One tick claims due schedules, reclaims expired leases, and prunes runs and results.
- **Missed ticks run once, not once per miss,** after downtime.

### Run records

```sql
create table selva.trigger_runs (
  id            uuid primary key default gen_random_uuid(),
  trigger_id    uuid not null references selva.triggers(id) on delete cascade,
  version_id    uuid not null,
  source        text not null check (source in ('http', 'schedule')),
  status        text not null
                check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  error_code    text,
  error_input   text,            -- the input that failed validation, if any
  delivery_key  text,            -- the sender's delivery id; see Storage
  claimed_until timestamptz,     -- lease while running; the tick reclaims an expired one
  result_key    text,            -- storage key of the solve result, until it expires
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
```

- **`GET /api/v1/definitions/{guid}/triggers/{id}/runs/{runId}`** (editors) and the
  [hook poll](#execution) (the sender) return the status and, once succeeded, the solve outputs in
  the shape the solve endpoint returns today. That shape is a display payload, not a contract, and
  is documented as such until outputs are typed.
- **The result carries a `format` field,** `"display"` today. Typed outputs add `"typed"` beside it,
  so a client can tell the two shapes apart without the existing one changing. The poll and `?wait`
  responses are public from the first slice, which is why the marker ships with them.
- **The result is stored apart from the row, briefly.** Outputs can carry what the inputs carried,
  so the result goes to the storage provider under `result_key`, with its own short retention
  setting, hours rather than days. The tick deletes it. After that a run reads as succeeded with its
  result expired.
- **The run row holds no payload.** See [Personal data](#personal-data).

### Personal data

Incoming bodies can carry personal data (a CRM contact, an ERP customer). See
[data-privacy.md](../../docs/self-hosting/concepts/data-privacy.md), which gains the trigger tables
in the slice that ships them.

- **Bodies and signature headers are never stored or logged,** on success or failure, including in
  the "test" action. Logs carry `triggerId`, `runId`, `versionId`, the error code and the input id.
- **After auth, errors name the input id and the reason, never the submitted value.**
- **`name` is free text** and personal data in practice, like an API token's name, so it is never
  logged or audited.
- **Erasure:** `created_by` goes null. `run_as_user_id` cascades, so erasing the user a trigger runs
  as deletes the trigger, as it deletes that user's API tokens. Results and run rows expire on their
  own retention.

### What stays small

A trigger is an adapter over the solve core, not a second execution path.

- **One pure function does the work:** `resolveInputs(payload, mapping, contract)` returns validated
  solve inputs or a list of input-level errors. The endpoint, the schedule, the "test" action and
  the save-time check all call it, so they can't disagree about what a mapping means.
- **After that it's the solve core** both solve routes call. Nothing in rate limiting, caching,
  Compute routing or metrics is reimplemented.
- **One owner check,** shared with `resolveApiToken`, so a key and a trigger can't disagree about
  who may still act.
- **Signing and verification live in one module,** shared with the outbound webhook dispatcher. The
  same Standard Webhooks code signs outbound and verifies inbound, and the presets are data in it.
- **One tick-driven runner** serves schedules and lease reclaims here and deliveries in webhooks.md:
  claim due rows, run, record. Two runners would be two sets of locking and retry bugs.
- **Responses are minimal.** Auth failures say nothing about why.

### Storage

The cached schema stays what
[ADR 0005](../../docs/adr/0005-uischema-version-and-disposable-schema-cache.md) says it is: a
disposable blob on the version row, owned and migrated by Compute. Nothing durable is built on its
shape.

- **Don't normalize the schema into tables.** It is read whole, by version, never queried by field,
  and the version list already leaves it out. Splitting it would freeze the blob's format as a
  contract and need a second migration path next to Compute's. Postgres stores a large `jsonb` out
  of line, so a row read that doesn't select `schema` doesn't pay for it.
- **Don't store anything derived from it.** See
  [Versions and migration](#versions-and-migration).
- **The contract region is already separable.** `inputs` and `outputs` are the contract; the layout
  and viewer options are presentation. Typed outputs land in `SchemaOutput`, which keeps contract and
  presentation apart without a new storage split. Revisit a physical split only if the blob shows up
  as a measured cost on a hot path.
- **What a trigger stores is its own contract,** so it is versioned and validated by us:

  ```sql
  create table selva.triggers (
    id                      uuid primary key default gen_random_uuid(),
    definition_guid         uuid not null references selva.definitions(guid) on delete cascade,
    name                    text not null,
    enabled                 boolean not null default true,
    status                  text not null default 'ok'
                            check (status in ('ok', 'broken', 'failing')),
    status_reason           text,
    run_as_user_id          uuid not null references auth.users(id) on delete cascade,
    sender                  jsonb not null,   -- sender profile
    secret_hash             text,             -- bearer: HMAC(SELVA_HMAC_KEY, secret)
    signing_secret_enc      text,             -- signature: enc:v1 envelope, SELVA_AT_REST_KEY
    prev_secret_hash        text,
    prev_signing_secret_enc text,
    prev_secret_expires_at  timestamptz,      -- rotation window
    mapping                 jsonb not null,   -- { v, mode, inputs, allow? }
    version_pin             uuid references selva.definition_versions(id) on delete restrict,
    cron                    text,
    cron_tz                 text,
    next_run_at             timestamptz,
    created_by              uuid references auth.users(id) on delete set null,
    created_at              timestamptz not null default now(),
    check ((secret_hash is null) <> (signing_secret_enc is null))
  );
  create index on selva.triggers (definition_guid);
  create index on selva.triggers (next_run_at) where enabled and cron is not null;
  ```

  `mapping` and `sender` stay `jsonb`: they are read whole on every request and written rarely,
  never queried by field. Both carry their own `v`, because unlike the schema blob nobody else
  migrates them. The partial index is the scheduler's claim query and nothing else.

  There is no `org_id`. A definition can move to another project, so a stored org could drift, and
  every path that reads a trigger loads its definition anyway.

- **Runs are an append-only table with retention,** not a log that grows forever. Dedupe is a unique
  key rather than an in-memory store, so it holds across instances:

  ```sql
  create unique index on selva.trigger_runs (trigger_id, delivery_key) where delivery_key is not null;
  create index on selva.trigger_runs (trigger_id, started_at desc);
  ```

  A duplicate delivery hits the unique key (`insert … on conflict do nothing`) and returns the
  existing run id. The tick prunes old runs. Retention is a setting with a floor above the longest
  sender retry window, because for a scheme with no timestamp the row is the only replay defence.

- **Re-validation costs one contract derivation per trigger, and only when a version goes live.**
  Nothing is stored for it; see [Versions and migration](#versions-and-migration).
- **Providers.** An `ITriggerStore` in `@selvajs/platform`, with a Supabase implementation (the
  tables above, row security by definition edit rights) and a local one (atomic-write JSON, claims
  in memory). The response schema drops the secret columns, the way share links drop their token
  hash.
- **The hook path reads with `SYSTEM_CONTEXT`,** as `resolveApiToken` reads a token by hash: the
  caller has no session for row security to check. That read returns only what verification needs.
  Everything after it runs under the run principal's delegated session.

### Versions and migration

A version is immutable, and so is everything derived from it. That settles where the contract lives
and what a trigger does when the definition changes.

**The contract is derived, per version, and never stored.**

- `deriveContract(schema)` returns `{ inputs, outputs }`. The input half is built from `SchemaInput`
  plus the layout join; the output half appears when outputs are typed and comes from `SchemaOutput`
  the same way. It carries a `contractVersion` constant for the derivation itself, separate from
  `schemaVersion`, and `loadContract` caches in memory by `(versionId, contractVersion)`, the same
  way solve caches definition bytes.
- Stored, it would be a second copy of something ADR 0005 already treats as a disposable cache, and
  a re-extract could leave the two disagreeing. Derived, it is always consistent with the version it
  describes.
- **It is addressable per version:** `GET /definitions/{guid}/versions/{versionId}/contract`, with
  `/definitions/{guid}/contract` as the alias for the live one, mirroring the `/schema`
  sub-resource. A version never changes, so the response caches indefinitely, keyed by the version
  id.
- **A solve is identified by `(versionId, inputs)`.** Run records already store the version, so a
  result can be reproduced and a caller can pin `versionId` in a solve (the field exists). Stability
  across versions is not promised by the contract; it is checked by `compareContracts`.

**Comparing contracts, not hashing them.** `compareContracts(from, to)` returns what changed, per
input id, and a verdict. A hash would call a new description or a renamed label a break and could
not say why. Equality would also shift when a newer plugin re-extracts the same bytes with extra
optional fields.

| Change between versions                                | Verdict                                                    | Effect on a trigger                                   |
| ------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| Nothing relevant, or description/label/layout only     | compatible                                                 | migrates silently                                     |
| New input                                              | compatible, noted                                          | takes its default; the UI lists it as "new, unmapped" |
| Mapped input removed                                   | breaking                                                   | trigger paused                                        |
| Mapped input's `paramType` or `inputStructure` changed | breaking, unless widening (`integer` to `number`)          | paused, or migrates if widening                       |
| Range narrowed, option removed                         | breaking only if a constant in the mapping now violates it | paused if so; payload values are checked per run      |
| Range widened, option added                            | compatible                                                 | migrates silently                                     |
| Input renamed, same id                                 | compatible for id-keyed mappings; flagged                  | migrates; nickname-keyed callers are listed           |
| Input re-placed in Grasshopper (new id)                | breaking                                                   | paused, with a suggested remap                        |

**What a trigger does on a version change.**

- **A trigger follows the live version by default,** and the check runs when a version goes live,
  including a rollback to an older one. Compatible changes **auto-migrate**: the trigger keeps firing
  and records `migrated` with the two version ids. Breaking changes pause it with the per-input
  reasons, as `broken`.
- **Status is recomputed, not sticky.** Rolling back to a compatible version, or editing the mapping,
  clears `broken` by re-running the check. Only a manual disable stays until someone re-enables it.
- **Correctness doesn't depend on the go-live check.** Every run resolves the live version when it
  is claimed and validates the mapping against that version's contract before solving, so a cron
  tick that lands between a publish and the check still can't solve with a stale mapping. The check
  only moves the status earlier, to a person instead of a 3 a.m. failure.
- **A paused schedule is visible.** Each missed tick records a `skipped` run with the reason, and the
  owner is notified once on the transition, not once per tick.
- **A remap is suggested, never applied silently.** When exactly one mapped id disappears and one new
  id appears with the same nickname and `paramType`, the UI offers the remap with a diff.
  Auto-applying it would route a payload field to an input that may mean something else.
- **Publish tells you first.** Publishing or making a version live can return the affected triggers
  and their verdicts (`dryRun`), so the person publishing sees "this pauses two triggers" before it
  happens.
- **A trigger may pin a version** instead of following live, for a schedule that must not change
  under it. The cost is a second way to go stale, so pinning is opt-in, and a pinned trigger never
  auto-migrates; it shows "newer compatible version available". The `version_pin` foreign key
  refuses deleting a pinned version, and the delete handler names the trigger.

**Keys.** The durable key for an input is its Grasshopper `id`; the `nickname` is accepted for
convenience at authoring time and in pass-through bodies (the MCP tools already resolve by label,
nickname or id), and is converted to the id when a mapping is saved. A rename therefore never breaks
a saved mapping. It can break a pass-through caller that keys by nickname, which is why the diff
lists renames.

**Chaining.** A chain step references a definition and a version policy (follow live or pin) and
wires one step's outputs to the next step's inputs. The wiring is validated by the same
`compareContracts` logic (an output's `dataType` assignable to an input's `paramType`) and migrates
under the same rules. Nothing about the input side changes to allow it.

### Contract documents and docs

`/api/v1` already has an OpenAPI 3.1 spec, generated from the Zod validators and the route registry
and checked for drift in `pnpm test`. It also drives the MCP package and the `/docs/api` page. It
describes the solve body generically (`inputs` array, `values` as a free-form map), because the
platform cannot know a definition's inputs. The per-definition contract fills that in, in the same
standard, with no new format.

- **Three outputs from one derivation:** `deriveContract` feeds `contractToJsonSchema` (JSON Schema
  2020-12, which OpenAPI 3.1 uses natively) and `contractToOpenApi`. There is no second place that
  decides what an input accepts.
- **`GET /definitions/{guid}/contract`** (and the per-version form) returns the JSON Schema for the
  inputs, and for the outputs once typed. It is what an MCP tool, a form builder or a validator
  imports.
- **`GET /definitions/{guid}/openapi.json`** returns an OpenAPI document for that one definition: the
  typed body of the solve (and of a trigger, for people who can edit it) and the run-status read.
  Power Automate, n8n, Zapier, Postman and code generators import OpenAPI and produce typed forms and
  clients from it. This is what makes a definition easy to put behind any of them.
- **Generated per request and cached by version id,** not committed. The platform spec stays the
  committed, drift-tested file; per-definition documents are data, not code.
- **Mapping a `paramType` to JSON Schema:** `number`/`integer` to the same with `minimum`/`maximum`
  from the widget; `boolean`; `text` with `maxLength` and `pattern` from the widget; `valueList` to
  `oneOf` of `const` and `title`, so the labels travel; `color` to a hex string; `file` to a URI
  string; `inputStructure` `list` to an array and `tree` to an object keyed by branch path. The
  Grasshopper `id` rides along as `x-selva-id`, the default as `default`. `stepSize` is a UI hint,
  not a `multipleOf`, so it goes in `x-selva-step`.
- **Property names are nicknames,** disambiguated with a short id suffix when two inputs share one
  (Grasshopper doesn't enforce unique nicknames). Both the nickname and the id are accepted on input;
  the saved mapping stores the id.
- **MCP uses the same JSON Schema** as the `inputSchema` of a per-definition tool, so Claude sees
  enums, ranges and required fields as structure instead of a sentence per input.
- **Generated docs page** per definition: the inputs table, a request example built from the
  defaults, the run-status call, and the version it describes. It shows only what the viewer may see;
  trigger URLs and ids appear only to people who can edit the definition.
- **Not GraphQL.** The surface is "run this function with these arguments", the argument shape is
  per definition and per version, and the tools people connect (no-code platforms, HTTP nodes, LLM
  tool calling) speak JSON Schema and OpenAPI. A GraphQL schema would have to be rebuilt per
  definition and would add a second server surface for no reader.
- **Chaining needs no Selva-specific format.** The OpenAPI Initiative's Arazzo specification
  describes sequences of API calls with one step's outputs feeding the next step's inputs. Check its
  fit when outputs are typed, before designing a pipeline document of our own.

### Management

- **New resource under a definition:** `GET/POST /api/v1/definitions/{guid}/triggers`,
  `PATCH/DELETE .../{id}`, `POST .../{id}/rotate-secret`, `POST .../{id}/test`,
  `POST .../{id}/handshake`, `GET .../{id}/runs`, `GET .../{id}/runs/{runId}`.
- **Creating a trigger, rotating its secret, and changing its auth or run principal are
  session-only,** like the token and service-account endpoints. A trigger secret is a credential: a
  leaked API token that could mint one would leave a door open after the token is revoked. Reading
  and the rest take a session or a token with `write` on the definition. The secret is returned once
  on create and rotate.
- **A "test" action** takes a sample payload, applies the mapping, and returns the resolved inputs or
  the validation errors without solving. This is how you build a mapping against a real sender
  payload.
- **Events:** `trigger.created`, `trigger.deleted`, `trigger.secret_rotated`, `trigger.migrated`,
  `trigger.broken`, `trigger.failing`, ids only. Each carries `orgId`, resolved from the definition
  at emit time, which [webhooks.md](./webhooks.md) requires of a deliverable event. These become
  deliverable once webhooks ship.
- **A failed run is not an event.** `audit_events` has no time-based retention, and a failing trigger
  would write a row per request. The run table holds failures; the event marks the transition.

## Build order

The order follows dependencies, and each slice is useful on its own and safe to stop after. This is
the reasoning for the sequence, not a task list: the tracker owns status, and each slice is a
candidate sub-issue ([CONVENTIONS.md](../CONVENTIONS.md)).

**Before any slice**, two things set the shape and are not code:

- Service accounts ([service-accounts.md](./service-accounts.md)) exist as a plan only. Slice 3 needs
  a principal to run as. Either they ship first, or triggers start by running as the creator and the
  UI says so.
- Whether `SchemaInput` gains `minimum`, `maximum` and `options`. It is a plugin and `schemaVersion`
  change, so it is its own track and nothing below waits for it. Range checks come from the layout
  join until it lands.

### 1. Contract foundation

No new storage, no new public surface beyond one read.

- `deriveContract` (inputs only) in `@selvajs/schemas`, lifting the join out of `mcp/tools.ts`, and
  `loadContract` over the render loader, cached in memory by `(versionId, contractVersion)`.
- `compareContracts`, with a test per row of the change table, including a PascalCase persisted
  schema and an unknown `paramType`.
- `contractToJsonSchema` and `GET /definitions/{guid}/contract` (and the per-version form),
  registered in the route registry, then `pnpm --filter @selvajs/selva openapi:generate`.
- Let the solve endpoint look inputs up from the version when the body omits `inputs`, additively.
  The MCP `selva_solve` then stops sending the schema's input list back.
- MCP describes and resolves through `/contract`. Behaviour unchanged; its tests are the proof.

_Why first:_ everything else reads the contract, and it is the only slice with no dependency.

### 2. Per-definition OpenAPI and docs

`contractToOpenApi`, `GET /definitions/{guid}/openapi.json`, the generated docs page, and the
per-definition MCP tool schema. Needs only slice 1. It ships before triggers because it is useful to
anyone already calling solve, and it exercises the generators against real definitions first.

### 3. Triggers over HTTP, bearer auth, no schedule

- Split `runSolve` into the transport-free core and its two route adapters, and move the owner check
  out of `resolveApiToken`. No behaviour change; the existing tests are the proof.
- `ITriggerStore` in `@selvajs/platform`, the local implementation, the Supabase migration for
  `triggers` and `trigger_runs`, and the response schema that drops secrets.
- `resolveInputs` with the restricted JSONPath, coercion against the contract, and its tests. The
  "test" action calls it, so it exists before the endpoint does.
- Management routes under a definition, in the registry and the OpenAPI spec.
- `POST /api/hooks/{id}` and the poll route: the self-gating prefix, the fixed check order, the
  capped body read, uniform `401`, rate and concurrency caps, dedupe through the unique key, `202`
  with a run id.
- The run lease and the runner's `tick()`, with lease reclaim and pruning only. A run can't be
  unattended without them, so they ship here rather than with schedules.
- Result storage with its own retention.
- Events and audit rows with ids only, and the data-privacy.md entry for the new tables.
- The trigger UI: list, create, mapper, test.

Every run validates against the live version's contract at claim time, so this slice is correct
without slice 4; slice 4 makes it pleasant.

### 4. Versions and migration

The go-live check using `compareContracts`, `migrated` and `broken` status, `skipped` runs, the
once-per-transition notification, remap suggestions, and the publish `dryRun`. It comes before
schedules because an unattended trigger is the one that needs it.

### 5. Schedules

Cron parsing with a time zone, the partial index, the missed-tick policy and constant-only inputs,
all on the runner from slice 3. The webhook dispatcher adopts the same runner.

### 6. Sender profiles and signature auth

The shared signing module (Standard Webhooks), the profile schema, the `signature` mode, the presets
with their vendor test vectors, the custom form, and the echo and capture handshakes. Bearer is
enough for n8n, Make, Zapier and Power Automate, so this is for senders that can only sign.

### 7. Outbound and batches

Webhooks per [webhooks.md](./webhooks.md), a `callbackUrl` on triggers through the dispatcher, file
inputs by URL once the pinned-connection fetch exists, and the fan-out decision for payloads that
carry many rows.

### 8. Typed outputs

Starts when the output typing settles. `SchemaOutput` gains its `dataType`, `deriveContract` gains
the output half, the generators follow, MCP gets richer outputs, and chaining is designed against
the Arazzo question above. Nothing earlier is reworked: the derivation, the generators and the
comparison were shaped to take it.

### Gates for every slice

`pnpm type-check && pnpm lint && pnpm test`, plus `pnpm --filter @selvajs/selva openapi:generate`
when a route changes, `pnpm generate` when either schema JSON changes, and
`cd Plugin && dotnet build && dotnet test` when C# does. Public routes are additive within v1. Docs
for self-hosters and the CHANGELOG entry land with the slice that makes them true.

## Output side (deferred)

Outputs only carry a display type today (`text | number | file | chart | dynamicValueList`), so
there is nothing for a caller or a downstream definition to type against. Until that lands:

- Run records return outputs as the solve endpoint does, marked `format: "display"`, and promise no
  shape beyond that.
- No callback URL on a trigger. A caller polls the run, or waits with `?wait`.
- No chaining.

When outputs are typed, three things follow without changing the input side: a `callbackUrl` on a
trigger that gets the typed result through the webhook dispatcher, the mapping check at save time,
and a trigger whose payload comes from another definition's outputs. The callback is signed with
Standard Webhooks and goes through the dispatcher's SSRF rules, so whatever sits after a trigger
verifies it with a stock library.

## Open questions

- **Which service account.** One per org for all triggers, or one per trigger. One per org is less
  to manage, but all its triggers share one compute bucket. One per trigger gives a clean audit
  trail, independent revocation and its own bucket.
- **File inputs.** A `file` input can't come from a JSON body. Options: a URL the engine fetches, or
  multipart. Likely URL-only in v1, and it makes a trigger an SSRF surface: a sender chooses the URL.
  `assertSafeRemoteDefinitionUrl` resolves the host and rejects blocked addresses, and the
  remote-definition fetch refuses redirects, but the check returns the URL and the fetch resolves it
  again, so a name can rebind between the two. That helper is not enough here. The fetch also needs
  the connection pinned to the validated IP, a per-trigger host allowlist, https only, and size and
  time caps. If that is too much for v1, file inputs wait.
- **Query-string secrets.** Dropped for log hygiene. If a real sender needs one, add it as an
  explicit, flagged "weaker" mode with log redaction, not a default.
- **Secrets in the body.** Microsoft Graph sends a `clientState` value in each notification rather
  than signing it. A third auth kind could compare a secret at a JSON path. It is weaker than a
  signature, since the secret travels with every delivery, so add it only for a real sender.
- **Geometry inputs** have no sensible JSON form from a no-code tool. Out of scope for v1; the
  mapping rejects them at save time.
- **Compute saturation.** The per-trigger concurrency cap bounds one trigger, and the `user:{id}`
  bucket bounds one principal. Nothing bounds an org with many principals, or a burst that fills
  Compute across triggers. Whether that needs a per-org budget depends on real traffic.
