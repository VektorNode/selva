# Plugin upload: a connection setting, and offering only what a key may do

**Archived 2026-11-09: built.** Connection setting, scoped upload dialog and project creation shipped.

Builds on [publish-from-plugin](./publish-from-plugin.md), which is built: browser sign-in
with PKCE, the key in the OS credential store, new definitions and new versions. This plan changes
where the connection lives, what the upload dialog offers, and lets the plugin create projects. The
evidence behind the decisions below is in
[plugin-upload-next-validation.md](./plugin-upload-next-validation.md). It works the same on every
auth provider: nothing here reads a provider directly.

## Decisions

### The connection is a machine setting, not a step in the upload dialog

- **Signing in, the account row and signing out move to a "Selva connection" setting.** It is not
  a builder sidebar panel, because those edit the schema. A sign-in belongs to this machine and
  this OS user, and is never saved in the `.gh`.
- **"Upload to Selva" shows only for a key Selva accepted in this Rhino session.** Signed out, the
  overflow menu offers "Connect to Selva…". The plugin asks `/me` when the builder first loads the
  account, and again after any refusal.
- **The verdict has three outcomes, keyed on the error code.**
  - Valid: the button shows.
  - Refused (403 `API_TOKEN_HOLDER_REFUSED`, or a scope the plugin can't use): the button hides,
    the key is kept, and the dialog says why.
  - Invalid (401): the key is forgotten.
  - A network error keeps the last verdict.
  - Sign out must work for a refused key, so `DELETE /me/token` skips the holder check.
- **The dialog opens straight at "Upload as"**, with a one-line account summary (who, which org,
  which instance) linking to the setting.
- **The upload request names its target.** `SelvaUploadRequest` carries the origin and token id the
  dialog showed (`wire-schema.json`, then `pnpm generate`), and the plugin refuses a mismatch. The
  first sign-in to an origin this machine has never used is confirmed in a native Rhino dialog,
  never by the page.
- **The address field refuses a pasted key.** Input containing `selva_`, or a host that is neither
  dotted nor loopback, is refused in the page and in `SelvaOrigin.TryNormalize`. Otherwise the key
  goes out in a DNS lookup.
- **The key still never enters the web UI.** It comes from the browser sign-in or from Rhino's own
  "Use an API key" dialog.

### Creating projects is a new scope, not a wider `upload`

- **A new scope action for creating projects**, requested by the built-in plugin client next to
  `read` and `upload`. Registered (DCR and CIMD) clients never get it. Widening `upload` instead
  would hand project creation to every upload key already issued, and change what past consents
  meant.
- **`POST /projects` accepts it.** That takes the registry entry and the route mount, which today
  defaults to `write`. `write` keeps covering it. A project- or definition-scoped key is still
  refused, because the route has no scope target.
- **One visibility gate for create and `PATCH`**, in `@selvajs/server`. A key with the new scope
  creates private projects only. Any other `visibility`, or `autoJoinOnUpload: true`, gets 403; an
  explicit `false` is fine.
- **Capabilities come from the server.** One helper in `@selvajs/server`, used by `createProject`
  and by `/me`, combines `canCreateProject` with the scope check. `/me` returns
  `capabilities.createProjects`. Clients never rebuild it from `orgPermissions`, which `/me` returns
  without narrowing them to the key.
- **The holder rule widens for keys carrying the new scope only:** "can create a definition in one
  project, or may create a project". `manage_api_tokens` is a platform permission org owners don't
  have, so an org admin with no projects needs this.
- **A per-owner quota on project creation by API-token callers**, because the per-token rate limit
  is per process.
- **The consent page, `describeApiScope` and the mint email** name the new scope. The archived
  publish-from-plugin plan, token-plan and the "Who may approve what" table in
  [signing-in-from-apps](../../docs/packages/build/signing-in-from-apps.md) are amended in the same
  change.

### The plugin's side of creating a project

- `SelvaTargets` gains `canCreateProjects`. The project picker under "New definition" then offers
  "New project…".
- **A missing capability field counts as false**, so an older server never offers what it can't
  do. `SelvaUploadService` currently treats a missing `canCreateDefinitions` and `canEdit` as true.
- **Project creation is its own stage.** Its JSON post sends one `Idempotency-Key` per attempt,
  which the multipart posts already do and JSON posts don't. The plugin keeps the created project's
  id, and treats a 409 on its own retry as "look it up by name". The server's idempotency store
  lasts minutes and lives in one process, so the key alone isn't enough.
- `nowhereToUpload` is false when the user can create a project, even with no projects yet.

## Rejected

- **A token field in the web UI.** The key would cross the WebSocket and sit in the page's memory,
  or in storage on a `localhost` origin the next app on that port inherits.
- **Widening `upload` to cover project creation.** It changes what every existing upload key and
  every past consent means.
- **`write` for the plugin.** It also deletes projects and definitions and creates public share
  links.
- **Working out capabilities in the plugin or the page.** The rule would exist twice and drift.

## Tests that must pin it

- **Scope:**
  - a key with the new scope creates a private project; another visibility or
    `autoJoinOnUpload: true` is refused, an explicit `false` isn't;
  - an `upload`-only key is still refused on `POST /projects` (`apiTokens.upload.test.ts` keeps its
    case);
  - a project-scoped key is refused;
  - a `write` key still creates projects with any visibility its owner may set.
- **Visibility gate:** a browser session without the public-visibility right gets 403 creating a
  public project, the same as on `PATCH`.
- **`/me`:** `capabilities.createProjects` is false for a member without `manage_projects`, true for
  an org admin, and false for a key without the new scope.
- **Holder:** an org admin with no projects can hold a key with the new scope. An upload-only key
  for the same admin still can't.
- **Plugin core:**
  - Upload is hidden until `/me` accepts the key;
  - a 403 hides it and keeps the key, a 401 forgets the key;
  - a missing capability field reads as false;
  - a retried project creation yields one project;
  - an upload whose origin or token id differs from the dialog's is refused;
  - a pasted `selva_` key is refused as an address.
