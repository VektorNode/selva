# Upload definitions from the plugin to Selva

**Tracked in: unfiled.**

A designer signs in to their Selva instance from the Grasshopper plugin, once, and from then on
uploads the open definition with one button: as a new definition, or as a new version of the one
this file was uploaded to before. The plugin holds the credential; the web UI it serves never
sees it.

Most of the server side exists. `POST /api/v1/definitions` and
`POST /api/v1/definitions/{guid}/versions` take a multipart upload, accept `selva_` keys and an
`Idempotency-Key`, and check the file on Rhino.Compute before writing anything. Selva is already
an OAuth authorization server for MCP clients ([mcp-next.md](./mcp-next.md) step 4), with PKCE
and loopback redirects on any port. What's missing is a scope that allows uploads and nothing
else, a client identity for the plugin, and the whole plugin side.

## The bridge has to be locked down first

The plugin's local WebSocket accepts any connection and hands out its session id to whoever asks.
A web page open in the same browser can do this while a UI Bridge is enabled:

1. Open `ws://localhost:8765`. The server never reads `Origin` or `Host`
   (`WebSocketServer.cs`, `WebSocketHandshake.cs`).
2. Send `{"type":"requestInitialData"}`, which is exempt from the session check
   (`InboundMessageParser.cs`).
3. Read the `sessionId`, schema, values and outputs from the `initialData` broadcast, which goes
   to every connected socket.
4. Send `valueUpdate`, `saveSchema` or `applySyncChanges` with that id: change inputs, overwrite
   the saved schema, rename parameters on the canvas.

That is a live problem today, independent of this plan, and it should be filed and fixed on its
own. Adding upload to this bridge before it's fixed would let any web page upload the open
definition to the user's Selva as them. The fix:

- **Check `Origin` at the handshake.** Allow only the origins of this component's own web
  server (`http://localhost:{webPort}` and `http://127.0.0.1:{webPort}`), plus the dev server's
  origin when the component runs in dev mode. Refuse a missing `Origin`: the only real client is
  a browser, and browsers always send it. On net48 the check runs on the `HttpListener` context
  before `AcceptWebSocketAsync`.
- **Check `Host`** against `localhost:{port}` and `127.0.0.1:{port}`, on the WebSocket and on
  `LocalWebServer`. This stops DNS rebinding.
- **Give the socket a secret and authenticate it once.** 32 random bytes from
  `RandomNumberGenerator`, beside the session id, which stays a short public label shown on the
  canvas. The plugin puts the secret in the page URL's fragment (`#s=…`), which never reaches a
  server log or a `Referer`; the page keeps it in `sessionStorage` so a reload or in-app
  navigation still works. The first message on a socket must carry it within a few seconds,
  compared in constant time, or the socket is closed with code 4401 and the page stops retrying.
  A socket gets no broadcast until it has authenticated, and `requestInitialData` loses its
  exemption from the session check.
- **Cheap extras on `LocalWebServer`:** `X-Frame-Options: DENY`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`. A full CSP is worth doing but needs the Plotly CDN,
  the Iconify API and the file input's URL fetch accounted for, so it's separate.

Browsers' own local-network restrictions don't cover this reliably, so the plugin can't count on
them.

## Threats and what answers each

| Threat                                                                    | Answer                                                                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A web page drives the plugin over its local WebSocket                     | The bridge lockdown above                                                                                                                                 |
| The token leaks from the web UI, its storage, or a dev server on the port | The token never crosses the bridge; it lives in C# and the OS credential store                                                                            |
| A leaked token is used                                                    | Upload-only scope that can't delete or share, 30 days, revocable at `/team/tokens`, never logged, every action audited with its id                        |
| Phishing: a look-alike OAuth client asks for upload rights                | Only the built-in plugin client can be granted `upload`, and it can only redirect to loopback                                                             |
| Another local app catches the authorization code on loopback              | PKCE S256: the code is useless without the verifier                                                                                                       |
| A forged callback injects an attacker's code                              | `state` checked in constant time, single use; PKCE                                                                                                        |
| Mix-up between two Selva instances                                        | `iss` checked against the issuer the plugin started with (RFC 9207); tokens stored per origin                                                             |
| MITM, downgrade, redirect to another host                                 | HTTPS only off loopback, default certificate validation, redirects never followed                                                                         |
| A Selva URL in server metadata launches something else on the machine     | Endpoints must be `https` on the issuer's origin before anything is opened                                                                                |
| The wrong file overwrites the wrong definition                            | Uploads land as a draft unless the user turns on Make live; versions are immutable, so live rolls back in Selva; the target is always shown and confirmed |
| A retry after a timeout creates the definition twice                      | One `Idempotency-Key` per upload attempt, reused by its retries                                                                                           |
| The plugin runs on a Rhino.Compute server (it loads the same `.gha`)      | Nothing in this feature constructs under `HeadlessGuard.IsHeadless`                                                                                       |

Out of reach, and said plainly in the docs: malware running as the same user. On Windows it can
read the user's generic credentials without a prompt. On macOS the keychain asks before another
app reads the item. Either way such malware could also inject into Rhino.

Uploading a definition means running its script components on the org's Compute server. That is
true of the web upload today and no doc says it. [security-and-limits.md](../../docs/self-hosting/concepts/security-and-limits.md)
gains a section on who can put code on Compute, and the plugin token is one more way in.

## Decisions

### Sign-in: authorization code with PKCE and a loopback redirect

The native-app pattern from RFC 8252, which Selva's authorization server already speaks.

1. The user enters the instance URL. The plugin reduces it to an origin: absolute URL, `https`
   (or `http` on `localhost`, `127.0.0.1`, `[::1]` only), no user info, path dropped. An
   internationalised host is shown in punycode so a look-alike domain is visible.
2. The plugin reads `/.well-known/oauth-authorization-server`, without following redirects. It
   refuses the instance unless `issuer` equals the origin exactly, the authorization and token
   endpoints are `https` on that origin, `S256` is supported, and `upload` is in
   `scopes_supported`. The last one is how an older Selva says it can't take uploads.
3. The plugin makes a PKCE verifier and `state`, 32 random bytes each, and opens a listener on
   `127.0.0.1` with a port the OS picks. It's a `TcpListener` on every target, as `LocalWebServer`
   already is, so net48 never needs a URL reservation.
4. It opens the system browser at the authorization endpoint, with `resource` set to the origin.
   Not an embedded web view: the user's single sign-on, passkeys and password manager work, and
   the plugin never sees a password.
5. The user signs in with whatever provider the instance uses, picks the org if they belong to
   several, and approves.
6. The listener takes one `GET /callback`. It checks `state`, then `iss`, answers with a fixed
   page ("Signed in. You can close this tab.") that echoes nothing back, and closes. It gives up
   after five minutes. `error=access_denied` reads as "cancelled".
7. The plugin redeems the code at the token endpoint, then calls `GET /api/v1/me` with the token
   to show who and which org it signed in as. Switching org means signing in again.

**Pasting a key instead.** Behind a "Use an API key" link, for places the browser flow can't
work. The plugin checks the key's format, calls `/me` with it and stores it the same way. When
its scopes go beyond `read` and `upload`, the plugin says what else the key can do and suggests
an upload key instead. It warns; it doesn't refuse.

### The plugin is a built-in client, not a registered one

Every Selva instance knows one first-party public client, `selva-grasshopper`, named "Selva for
Grasshopper", whose only redirect is `http://127.0.0.1/callback` (any port). It sits beside DCR
and CIMD clients in `@selvajs/server/oauth`.

- Air-gapped instances work: there's no registration call and no metadata document to fetch.
- The consent page can show the client as built in. A DCR client's name is whatever the
  registrant typed.
- **Only this client may be granted `upload`.** A DCR or CIMD client that asks for it gets read
  and solve at most. That takes away the reason to phish someone with a fake "Selva for
  Grasshopper" registration that redirects to a web site.

Any local program can use this client id; that's true of every public native client. The loopback
redirect means the code can only ever reach the user's own machine, and PKCE means only the
program that started the flow can redeem it.

### A new `upload` action

Today a token's actions are `read`, `write` and `solve`, and OAuth grants only `read` and `solve`.
Uploading needs `write`, and `write:all` can also delete projects and definitions, edit any
definition's metadata and create public share links. Thirty days of that on a designer's laptop
is far more than the button needs.

`upload` allows exactly four routes: `POST /definitions`, `POST /definitions/{guid}/versions`,
`POST /definitions/{guid}/publish` and `POST /compute/schema`. It includes `read`, and `write`
includes it. In `scopeAllows` that's one more case in `actionCovers`. An upload key that tries
anything else gets the usual 403 naming the missing scope.

The three definition routes declare it in the registry the way solve routes declare `solve`;
`/compute/schema` checks scope by hand with `assertScope`, so it asks for `upload` there.

This amends [token-plan.md](./token-plan.md), which rejected new actions "as more engine surface
than anything needs today". Now something needs it; the decision is changed there, not restated
here.

Uploads land as the definition's draft. The dialog's **Make live** toggle, off by default, then
calls `POST /definitions/{guid}/publish` with the new version. Having the publish route in
`upload` means a leaked upload key can swap what every user of a definition gets. It still can't
delete anything, and a rollback in Selva points live back at any earlier version.

### Who may hold an upload key

Holding any key needs the platform permission `manage_api_tokens`, which no regular user has, and
which also lets its holder mint `write:all` keys for 180 days. So the holder check looks at the
key's scopes. A key whose scopes are only `read` and `upload` needs only the right to create a
definition in at least one project of the token's org: it can do nothing the user's browser
session can't. Anything broader still needs `manage_api_tokens`.

The check runs at mint and on every request, as it does today, so a designer who loses their
last editable project loses the key's use with it. `ApiTokenHolderPolicy` takes only the context
today; it gains the key's scopes. `/team/tokens` shows to these users too, so they can see and
revoke their keys, and its mint form offers them only the upload preset.

This amends the token plan's holding rule as well.

### Storing the token

The OS credential store, keyed by instance origin: Windows Credential Manager (a generic
credential, `CRED_PERSIST_LOCAL_MACHINE` so it doesn't roam) and the macOS keychain (a generic
password). Both encrypt with the user's login, both let the user see and delete the entry, and on
macOS other apps are prompted before they can read it. The plugin calls the OS through P/Invoke
behind one `ICredentialStore`, without a NuGet package: anything added to the `.gha` can clash
with what Rhino loads, and both APIs are small.

An encrypted file of our own would need its key on the same disk, in the `.gha` or next to the
file. That's obfuscation, not encryption.

Only the secret goes in the credential store. The list of instances the user has signed in to,
with display name, org and expiry, is plain JSON under the plugin's AppData folder; none of it is
secret. The token never goes in the `.gh`, the UI schema, the web UI's storage, or a log line.

If the credential store isn't available, the token lives in memory until Rhino closes and the UI
says so.

### Talking to Selva

One `HttpClient` per instance, separate from `FileImporter`'s. That one's SSRF guard refuses
private addresses, and a company's Selva is often on one; here the user picked the host.

- `AllowAutoRedirect = false`. A redirect is an error that names where it pointed, so a token is
  never forwarded to another host and HTTPS never quietly becomes HTTP.
- The `Authorization` header is added per request, after checking that the request's origin is
  the token's origin.
- Default certificate validation, never overridden; the system proxy as it is.
- A size cap on every JSON response, timeouts on everything, cancellation on upload.
- `User-Agent: Selva-Grasshopper/<version> (Rhino <version>; <os>)`, so the server can refuse
  plugin versions it knows are broken ([plugin-compat-gate.md](./plugin-compat-gate.md)).
- Nothing opens in the system browser unless it's an `https` URL on the instance origin built by
  the plugin. A string from the server is never handed to the shell; on Windows that would run
  any registered protocol handler.

### The web UI never holds the token

The web UI asks; the plugin acts. New messages on the bridge, with their payloads in
`wire-schema.json` and pinned by the shared wire fixtures like the existing ones:

- in: `selvaConnect {origin}`, `selvaSignIn`, `selvaSignOut`, `selvaListTargets`,
  `selvaUpload {target, metadata | changeNote}`, `selvaCancel`
- out: `selvaAccount {status, origin, user, org, expiresAt}`, `selvaTargets`,
  `selvaUploadProgress`, `selvaUploadResult`

None of them carries the token. A fixture test fails if any outbound envelope has a `selva_`
string in it.

Doing it all in the browser instead was considered and rejected below.

### New definition or new version

After an upload the plugin writes a link into the UI Bridge component's archive chunk, next to
`Schema` and `Values`: `{origin, definitionGuid, versionId, versionNumber}`, one per instance. It's
not in the UI schema: the schema is shared with every host and exported in `.sls` files, while
the link belongs to one instance. Reading tolerates its absence, and it isn't a param change, so
no OBSOLETE upgrade is needed. Writing it marks the document modified; the user saves as usual.

When the upload dialog opens:

1. **The file has a link for this instance.** The plugin loads the definition. If it's there and
   the user can edit it, the dialog suggests "New version of _Facade panel_ in _Tower_". If
   Selva's newest version isn't the one this file last uploaded, it says who uploaded what since.
2. **No link, but Selva knows the file.** Every extracted schema carries the Grasshopper
   `documentId`, but only inside the version's JSON blob. A `source_document_id` column on
   definitions, set at create and on each version upload, lets
   `GET /api/v1/definitions?documentId=` return the definitions the caller can edit. That catches
   files first uploaded through the web, or from another machine.
3. **Neither.** A new definition: project picker limited to projects the user can create in,
   with name, description, category and tags filled from the schema.

The user can always switch to a new definition or pick another definition by hand. Nothing is
matched by name; a copied file keeps its `documentId`, so the suggestion is always shown and
confirmed, never applied.

### What gets uploaded

The plugin serialises the open document in memory with `GH_Archive`, on the UI thread, so
unsaved canvas changes go up and the file on disk isn't touched. Upload is disabled while the
builder has unsaved schema changes: Compute reads the schema saved in the component, and an
unsaved one would go up stale.

The dialog shows the size against the instance's limit and says what's in the file: the whole
definition, including internalised data and script source.

### Expiry and signing out

Tokens live 30 days with no refresh token, the rule [mcp-next.md](./mcp-next.md) already set. The
account row shows when sign-in runs out. A 401 with `invalid_token` deletes the stored token and
asks the user to sign in again.

Signing out calls a new `DELETE /api/v1/me/token`, which revokes the key that sent it, then
deletes the credential. A key may revoke itself and nothing else, so this stays inside the token
plan's rule that keys can't manage keys. It's under `/api/v1`, so forward-auth proxies already let
it through. If the call fails, the credential is deleted anyway and the UI says the token stays
valid until it expires or is revoked at `/team/tokens`.

## Server changes

- **`upload` action** in `@selvajs/platform` apiTokens, declared on the four routes, documented
  in OpenAPI, with an "Upload definitions" preset on `/team/tokens`.
- **The holder rule** that lets upload-only keys go to anyone who can create a definition.
- **The built-in client** and per-client scope allowlist in `@selvajs/server/oauth`; consent copy
  for `upload`; `upload` in `scopes_supported`.
- **The org picker on the consent page**, designed in [mcp-next.md](./mcp-next.md) and built
  here. Consent uses the acting org today, which is the user's first membership, so a user in
  two orgs could only ever upload to the first. It fixes MCP sign-in for them too.
- **Consent mints through the core, not `event.fetch`.** The approve action posts to its own
  token endpoint with SvelteKit's internal fetch, which forwards only `cookie` and
  `authorization`. Header-auth identity comes from `SELVA-*` headers, which are dropped, so by
  reading the code approval fails on forward-auth deployments. That's MCP sign-in on Entra too.
  Calling `createApiToken` with `locals.ctx` fixes both and is what route handlers should do
  anyway. It needs a test through the real hook with the header-auth provider, not a stubbed
  `fetch`.
- **`DELETE /api/v1/me/token`**, self-revoke, reason `owner`.
- **Write rights in listings.** `GET /projects` items gain `canCreateDefinitions`, and
  `GET /definitions/{guid}` gains `canEdit`, so the plugin offers only targets that will work.
- **`source_document_id`** on definitions: a migration on Supabase, a field on the local store,
  the `documentId` filter on `GET /definitions`.
- **Docs:** the upload trust model in security-and-limits; a page on signing in from apps that
  grows out of [mcp.md](../../docs/self-hosting/concepts/mcp.md); the token plan's amended
  action list.

## Plugin changes

- **The bridge lockdown**, first and on its own.
- **A Selva client** under `Selva.GH/Features/`: origin normalising, metadata checks, PKCE,
  callback parsing and the HTTP rules are Rhino-free and linked into `Selva.Tests`, as the wire
  parser is. The credential store has a Windows and a macOS implementation.
- **Bridge messages** above, with fixtures on both sides.
- **The link** in the component's archive chunk.
- **plugin-ui:** an account row (instance, who, org, expiry, sign in and out, "Use an API key"),
  an "Upload to Selva" button in the builder header, and the dialog described above with its
  Make live toggle. Its layout gets a mockup first. "Upload", because in Selva "publish" already
  means making a version live; the toggle uses that word for that.

## Order

1. The bridge lockdown. It ships whether or not the rest does.
2. Server: the `upload` action, the holder rule, the built-in client, the consent fix and org
   picker, self-revoke, write rights in listings.
3. Plugin: sign-in, credential store, new definitions, new versions through the file link.
4. Server and plugin: the `documentId` lookup.

Each step is usable alone. After step 3 a file uploaded through the web gets offered as a new
definition until step 4 lands.

## Rejected

- **The web UI does the OAuth and holds the token.** Selva's `/api/v1` would need CORS for
  loopback origins, which opens it to every local web page. A token kept in the page's storage
  lives on `http://localhost:<port>`, an origin the next app on that port inherits; the dev
  server's `5173` is shared by every project on the machine.
- **Device authorization grant (RFC 8628).** It's for devices without a browser. It needs a
  server-side store for pending codes, and "enter this code" is a known phishing pattern. The
  plugin and the browser are on the same machine, so loopback works.
- **Embedded web view.** RFC 8252 forbids it for good reason: no single sign-on, and the plugin
  could read the password.
- **Password grant.** Gone in OAuth 2.1, and useless with Entra or Supabase sign-in.
- **`write:all` for the plugin.** See the `upload` action.
- **Keeping `manage_api_tokens` as the gate.** Every designer who uploads would need an admin to
  grant it, and with it the right to mint broad keys they don't need.
- **A project-scoped write key chosen at consent.** `POST /definitions` can't name a project
  before the body is parsed, so it has no `scopeTarget` and refuses project keys. A project
  picked at consent would also need a new sign-in for every new project.
- **Refresh tokens.** The 30-day rule stands until monthly sign-in proves annoying, as in
  [mcp-next.md](./mcp-next.md).
- **Plain HTTP to a non-loopback instance.** The bearer key would cross the network in clear.
  There's no override.
- **The link in the UI schema.** The schema is shared with every host; the link belongs to one
  instance.

## Known gaps

- Consent mints the token before the code is redeemed. If the plugin never redeems it (Rhino
  closed, listener timed out), a 30-day key is left over. It shows on `/team/tokens` and can be
  revoked there.
- Redeemed codes are remembered per process, so with several replicas a code could be redeemed
  once per replica within its minute, and only with the PKCE verifier.

## Tests that must pin it

- **Bridge:** a foreign or missing `Origin` is refused; a wrong `Host` is refused; a socket that
  hasn't authenticated gets no broadcast and can't send `requestInitialData`.
- **Scope:** an `upload` key creates definitions and versions and makes a version live, and
  fails on PATCH, DELETE, share links and project creation. A `write` key still uploads.
- **Holder:** a user who can't create a definition anywhere in the org can't hold an upload key;
  a key with `write` still needs `manage_api_tokens`; an upload key stops working when its owner
  loses their last editable project.
- **OAuth:** a DCR or CIMD client asking for `upload` gets at most read and solve. The built-in
  client refuses a non-loopback redirect. Approval works on header-auth through the real hook.
  The key lands in the org the user picked, and an org they don't belong to can't be picked.
- **Plugin, Rhino-free:** a table of instance URLs and their outcomes; metadata with a different
  issuer, an off-origin endpoint or a non-`https` endpoint refused; callbacks with a wrong
  `state`, wrong `iss`, no code, or `error=access_denied`; a 3xx neither followed nor sent the
  token; no outbound envelope containing a `selva_` string.
- **By hand, per OS:** the credential store round trip, and that a second app on macOS gets a
  keychain prompt.
