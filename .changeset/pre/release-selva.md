---
'@selvajs/selva': minor
---

API tokens, a public `/api/v1`, MCP with OAuth sign-in, Grasshopper plugin upload, and deployment config you can inspect and rotate safely.

**Action needed when upgrading**

- Supabase deployments: run `npx selva-supabase`, then `npx supabase db push`, before starting the new version. This release ships several migrations.
- Retired env vars are ignored and logged at boot; `selva migrate` removes them. Among them: `COMPUTE_SOLVE_DEADLINE_MS`, `COMPUTE_REUSE_DEFINITION_CACHE`, `COMPUTE_CACHE_ERRORED_SOLVES`, `COMPUTE_REQUEST_MAX_BYTES` (fixed 256 MB), `COMPUTE_RESPONSE_MAX_BYTES` (fixed 300 MB) and `MAX_IMAGE_FILE_SIZE_BYTES` (fixed 10 MB).
- A solve's deadline and definition-cache reuse come from the compute server's `GET /limits`. A server that doesn't answer gets a 100 s deadline and a definition re-upload on every solve.
- A bad value on a security setting now stops boot instead of falling back: `SELVA_HMAC_KEY` missing or under 32 characters (checked under every auth provider, header auth included), an `SELVA_AT_REST_KEY` that isn't 32 bytes, booleans outside `true|false|1|0|yes|no|on|off`, malformed URLs and out-of-range ports. Run `selva config show` or `selva migrate --dry-run` to check `.env`.
- Header auth: the email fallback no longer matches the allowlist's `email` column. API tokens, MCP and plugin upload need Caddy routes that skip `forward_auth` (see the header-auth guide).
- A hand-written compute server id that isn't a UUID has to become one before compute config can be saved again. Compute server ids must also be unique across orgs and the platform.
- `POST /api/v1/definitions/{guid}/solve` solves a stored definition's inputs from the version's schema. `inputs` in the body is deprecated and ignored; omitting it solves the stored inputs, not the file's defaults. Number widget bounds are enforced on the server.
- 429 bodies carry the code `RATE_LIMITED`; the compute route moves `retryAfter` to `details.retryAfter` (the `Retry-After` header is unchanged).
- Share links minted without `expiresAt` expire after 90 days. An explicit `expiresAt: null` still means never.
- `docs`, `mcp` and `oauth` are reserved org slugs.
- A definition with only Local render on (`viewerOptions.enableLocal`) opens without a viewer: Selva's viewer follows Compute render (`enableRemote`) alone.

**API tokens and `/api/v1`**

- Org-scoped API keys (`selva_…`) with `read`, `upload`, `create_projects` and `write` actions, managed at `/team/tokens` and through `POST`/`GET /api/v1/orgs/{orgId}/tokens` and `DELETE /api/v1/orgs/{orgId}/tokens/{tokenId}`. Minting a full key needs `manage_api_tokens`; an upload-only key can be held by anyone who may create a definition. The owner gets an email when a key is minted.
- A key reaches only its own org and its owner's current rights: removing a member or disabling a user revokes their keys, and the holder rule is re-checked on every request.
- Per-key rate limit (600 per 60 s by default, `API_TOKEN_RATE_LIMIT_MAX`, `API_TOKEN_RATE_LIMIT_WINDOW_MS`) with `RateLimit-*` headers, and `Idempotency-Key` on project, definition, version, share-link and solve creates.
- `SIGN_IN_MAX_AGE_DAYS` limits how long one identity-provider sign-in lasts for keys, consent and session refresh. `API_TOKEN_SIGN_IN_WINDOW_DAYS` retires keys whose owner stops coming through a header-auth proxy. Both are off unless set.
- `GET /api/v1/openapi.json` publishes the spec. `GET /api/v1/me` reports the caller's key, scopes, expiry and `capabilities`. `DELETE /api/v1/me/token` lets a key revoke itself.
- Changing or removing org members, and invites, need a browser session; an API key gets 403.
- A `SELVA_HMAC_KEY` shorter than 32 characters turns API tokens off (503) instead of failing every request.

**MCP and OAuth**

- `/mcp` serves the API as MCP tools: `selva_list_projects`, `selva_list_definitions`, `selva_describe_definition`, `selva_solve` and `selva_publish_definition`, filtered by the key's scopes. `MCP_ALLOWED_ORIGINS` lists extra browser origins it accepts.
- MCP clients sign in through the browser: OAuth discovery, registration, a consent page at `/oauth/authorize` and a token endpoint. Approval mints a 30-day key in the acting org.
- The Grasshopper plugin signs in through the same flow and uploads definitions, optionally into a new private project. Uploading fills the definition's category from the schema.

**Deployment and operations**

- `/admin/system` shows the resolved configuration: what `.env` sets, defaults, invalid values and unknown keys. See `selva config` in `@selvajs/cli`.
- Key rotation keeps the old key working for 30 days through `SELVA_HMAC_KEY_PREVIOUS` / `SELVA_AT_REST_KEY_PREVIOUS` (`selva keys rotate`). Boot re-seals stored compute API keys under the new at-rest key.
- Share-link, invite and API tokens are stored as unkeyed SHA-256; existing tokens keep resolving.
- An `http://` `ORIGIN` drops the `Secure` cookie flag, so sign-in over plain HTTP works without `ALLOW_INSECURE_COOKIES`.
- Restarts no longer wait out PM2's `kill_timeout`, and open tabs show a "Selva has been updated" notice with Reload.
- `SENTRY_TRACES_SAMPLE_RATE` sets trace sampling; Sentry events are scrubbed of cookies, auth headers, bodies and query strings before they leave. Requests are timed with `Server-Timing` and sampled `[timing]` logs.
- Built on SvelteKit 3. `.env`, the start command and the proxy setup are unchanged; Selva applies `ORIGIN` itself.

**Security**

- One user can no longer choose what another user's solve returns: the shared solve cache keys on SHA-256 instead of a collidable 32-bit hash.
- The Rhino.Compute API key no longer follows a redirect from the compute server; a redirecting server URL fails with a message naming the address to configure.
- Changing a compute server's URL requires re-entering or clearing its API key (409 otherwise), so a stored key can't be redirected to another host. Org compute config can no longer be changed with an API key.
- Stored compute API keys are bound to their server id, so ciphertext can't be replayed to decrypt another tenant's key. An org admin can no longer reuse another tenant's server id.
- Access-rule fixes: commons uploads need `canView`; two admins or owners removing each other can't leave none; invite resend runs the same gates as invite creation; accepting an invite adds permissions instead of replacing them and checks the inviter still vouches; `safeRedirectTarget` refuses control characters.
- Form-CSRF moves into the hook, so the OAuth token endpoint and key-authenticated multipart uploads aren't refused in production.

**Solving**

- `generic` inputs reach Grasshopper. A number or boolean that can't be coerced is left out so Grasshopper keeps its own value, instead of sending `0` or `false`. Text, colour and file values are sent as entered.
- Compute responses past `COMPUTE_RESPONSE_MAX_BYTES` are cut off mid-download. Solves of 300 s or more work. A cached solve reuses its gzipped body, and responses gzip at level 1.
- Concurrent requests with an expired session share one token exchange, so a provider that rotates refresh tokens no longer signs the user out.
- Fewer sequential reads on the solve, team, members, user-admin and token pages.

**UI**

- Hanken Grotesk typeface, one content width, one dropdown component, a new surface system for light and dark, and a phone layout: icon-only nav, one header menu, a project picker on `/projects`, and tables that drop secondary columns.
- The admin health page reports whether API token sessions work. The admin compute pages show an unusable stored server URL or key instead of failing with a 500.
- `selva update` and `selva doctor` catch a database that is behind the app (`build/runtime-meta.json` records the expected migration head).

**Erasure**

- Supabase: erasing a user no longer deletes orgs or projects they created; ownership goes to the erased actor. `DELETE /api/admin/users/[id]` answers 409 for an org's only owner.
- Deleting an org or project removes its stored blobs.

Dependencies updated.
