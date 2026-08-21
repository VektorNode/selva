# @selvajs/selva

## 4.15.0

### Minor Changes

- 356834d: Admin health check now reports the reverse-proxy and upload-limit settings

  `ADDRESS_HEADER`, `XFF_DEPTH` and `BODY_SIZE_LIMIT` are read by adapter-node, not
  by Selva, so misconfiguring them fails nothing at boot and logs nothing at
  runtime — while every user shares one login rate-limit bucket, or every large
  upload 413s. `selva doctor` has always caught these on the host; the admin panel
  showed only runtime state, so an operator who never opened a shell read it as
  all clear.

  The rules move into `@selvajs/server/ops` (`checkDeploymentConfig`) and run in
  `/api/admin/system/health`. A `doctor` red maps to `error`, a yellow to
  `degraded`, so the panel's overall verdict matches the CLI's exit code.

  The CLI keeps its own copy — it is dependency-free by design, since it scaffolds
  the deployment that installs the runtime. Both sides now assert one shared
  fixture table, so a rule changed on one and not the other fails CI.

- 4d16b79: Outbound mail moves behind an `INotificationProvider` seam

  Selva had two mail systems that did not know about each other: GoTrue owned magic
  links, and `$lib/server/email/` owned invites — one renderer wired straight to
  nodemailer, living inside the app. Neither is wrong alone, but the next message
  (a failed solve, a shared project) had nowhere to go except a third path, and
  then every mail Selva sends looks different and obeys different rules.

  `@selvajs/platform/notifications` adds the transport interface —
  `INotificationProvider`, `OutboundMessage`, `SendResult`, `NotificationKind`, and
  a `NoopNotificationProvider` for instances that send nothing. `send` must not
  throw: by the time it runs the invite row is already committed and the caller
  still holds the accept URL, so a dead SMTP host must not turn a successful write
  into a failed request. `not-configured` stays distinct from `failed` because an
  instance with no mail server is a supported deployment, not a broken one.

  `@selvajs/server/notifications` adds `SmtpNotificationProvider`, a lift of the
  app's old mailer with nodemailer as an optional peer. `readSmtpConfig` now takes
  an env bag rather than importing SvelteKit's `$env/dynamic/private` — the
  provider lives outside the app, and under `vite dev` Vite does not mirror `.env`
  into `process.env`, so a provider reading it directly would ignore every
  override.

  Templates move to a new private `@selvajs/notifications`, where they are pure
  render with no I/O, no env and no transport. One shared layout wrapper and one
  `escapeHtml` replace the per-file copies.

  No behaviour change: same mail, same SMTP settings, same fallback to sharing an
  invite link by hand when mail is off.

## 4.14.2

### Patch Changes

- 66945ae: Close the six findings from the app security audit.

  **One setting needs an operator's hand — the code cannot apply it.**

  `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=<proxy count>` were already documented but unset. Without them `getClientAddress()` returns the socket peer, which behind a reverse proxy is `127.0.0.1` for every request from every user — so the login limiter had exactly one bucket. Five failed logins from anywhere returned 429 to everyone, and only a successful login clears a bucket, which nobody could then reach. Cheap unauthenticated denial of service against a whole instance, renewable indefinitely.

  Four changes cover the gap until an operator sets them. A per-account failure counter now runs alongside the per-IP one, keyed on the normalized email — per-IP bounds nothing against an attacker spread across source addresses, and per-account is what protects a targeted user. The app logs a warning the first time a login arrives from loopback with `ADDRESS_HEADER` unset. `selva doctor` reports the pair as red when `ORIGIN` is set (a proxy is in play) and `ADDRESS_HEADER` is not, and yellow when `X-Forwarded-For` is trusted without an `XFF_DEPTH` to say which hop is real. And `selva proxy` prints the two lines to add after it configures Caddy, since that is the moment the operator creates the condition.

  Doctor stays quiet when `ORIGIN` is unset. On a directly-reachable app these settings are a footgun — `X-Forwarded-For` is client-supplied, so trusting it there lets any caller choose their own rate-limit bucket.

  Caddy needs no change: `reverse_proxy` already sends the header. Only the app's willingness to trust it was missing.

  **The rest carry no deployment impact.**

  A compute `serverUrl` saved at `/admin/compute` is validated: `http`/`https` only, and never the link-local range. That URL is fetched server-side on every status probe and every solve, so an unfiltered one lets whoever holds `manage_compute` point the app at `http://169.254.169.254/latest/meta-data/` and read the host's own cloud credentials. Loopback and LAN addresses stay allowed, since running compute on `localhost` or an internal box is the ordinary self-hosted layout — blocking those would break working deployments and push operators toward disabling the guard entirely. `169.254.0.0/16` is the one range no legitimate compute server uses.

  `/admin/*`, `/setup` and `/login` are no longer framable. Selva apps are built for iframe embedding and app routes stay that way, but that tradeoff was being applied uniformly, leaving an authenticated instance admin open to UI-redress. `applySecurityHeaders` gained an opt-in `denyFraming` option — additive, so existing callers are unaffected.

  The OAuth callback checks a CSRF nonce before exchanging the code. It is a GET that mints a session cookie, and SvelteKit's origin check only covers form POSTs, so an attacker could capture a `?code=` from their own flow and induce a victim to load it — silently signing the victim into the attacker's account, where everything they then do is visible. Supabase does not expose the real OAuth `state` and `exchangeOAuthCode` takes only `code`, so the nonce is minted at `/auth/supabase/start`, carried on the callback URL, and compared against a short-lived cookie. Single-use, cleared on failure as well as success.

  `auth-users.json` and `compute.config.json` are written `0600` in a `0700` directory. The shared write helper set no mode, and `rename` preserves the temp file's umask bits, so PBKDF2 password hashes were landing world-readable — any other local user or co-tenant service on the host could copy and crack them offline. No-op on Windows.

  API 500s log through pino instead of raw `console.error`. Provider adapters stash connection details on `cause`, and handing that object to stdout puts it somewhere redaction never runs and erasure cannot follow.

  `SELVA_HMAC_KEY` now refuses the `.env.example` placeholder. At 41 characters it cleared the 32-char minimum, so an operator who copied the file without rotating booted with a session-signing key that is public in this repo — every token forgeable. `selva doctor` caught it, but nothing forces anyone to run doctor.

## 4.14.1

### Patch Changes

- d6b7aa2: Say why an update rolled back instead of printing the raw health body and stopping.

  The runner already fetched `/api/health` and printed its response before rolling back, but nothing parsed it. An operator whose update failed because the Supabase migrations for the new version had not been applied saw a wall of JSON, a rollback, and no statement of cause — so the obvious next move was to retry, which fails identically every time. The database, not the release, was the thing needing attention, and nothing said so.

  The rollback path now classifies that response and names the cause. A schema mismatch prints a `SCHEMA_SKEW` marker carrying both migration heads and the two commands that fix it (`sync-migrations`, then `supabase db push`), and says outright that retrying without them repeats the same failure. A compute-key decryption failure gets the same treatment under `AT_REST_SECRETS`. A response matching neither says so plainly rather than staying silent.

  `deriveOutcome` classifies both markers ahead of the generic rollback case, so the admin UI headline names the version skew and the detail carries the fix — the generic "review the log below for why the new version failed" was actively misleading here, since the log holds nothing about the new version.

  Both markers state that Selva does not apply migrations during an update. That is deliberate and worth an operator knowing: migrations are not reversible, so auto-applying them and then rolling the code back on any unrelated health failure would strand the app and the database on different heads, and the rollback is only trustworthy because it stays out of the database.

  Not addressed: the check still runs after the app has been stopped, so a skewed deployment takes the full probe window of downtime before rolling back. Catching it during pre-flight needs the target version's expected migration head before install, which is only readable from inside the package tarball.

## 4.14.0

### Minor Changes

- fe4cbec: Email invitations directly instead of copying the link by hand.

  Set `SMTP_HOST`/`SMTP_FROM` (see `.env.example`) and creating an invite mails the accept link to the invitee. Sending is best-effort — with SMTP unconfigured, or if delivery fails, the link is still returned for manual sharing, and the members page says which happened.

  Adds `POST /api/v1/orgs/{orgId}/invites/{id}/resend`, surfaced as a Resend button. Because the raw token is never stored, a resend mints a replacement and revokes the original: the previous link stops working.

### Patch Changes

- fe4cbec: Fix the display name typed at invite signup being silently discarded.

  `updateProfile` patches an existing data-layer row and reports `not_found` for a missing one. A new invitee has no row yet — `ensureUser` seeds it on the first authed request, which has not happened at signup — so the name was dropped and the UI fell back to the email's local part. Seed the row first, and log a non-`ok` result instead of swallowing it.

## 4.13.1

### Patch Changes

- e782803: chore(deps): bump the npm group across 1 directory with 12 updates

## 4.13.0

### Minor Changes

- 8d71c01: Wire org-member removal into `/team/members`, and stop rendering the same email twice.

  `DELETE /api/v1/orgs/{orgId}/members/{userId}` had been fully built and tested —
  the owner-only gate, the sole-owner 409, the invite revocation that closes the
  re-entry path, the `org_member.removed_orphaning_projects` event — but nothing on
  the page called it. The only reachable delete control was the one on the invites
  list, which revokes an unaccepted invite and not a membership, so an operator's
  route to removing someone from an org was the API directly. Instance scope
  (`/admin/users`) and project scope (the settings dialog) both already had theirs.

  The button mirrors the route's gates rather than inventing new ones: no
  self-removal, no removing the sole owner, and no admin removing an owner —
  `canChangeOrgRole` again, on the harder-to-reverse half of the pair. Those live in
  `removal-gate.ts` beside the page, not inline in the component, so they are
  unit-testable; the route stays load-bearing. The confirm copy names what the
  server will not block, since removal proceeds and **reports** the projects it
  orphans: it says they can be adopted from Team → Reclaim, which is the recovery
  path that already existed for exactly this.

  Separately, header-auth deployments were showing `x@y.com · x@y.com` on the admin
  user list. The provider mirrors `email` and `displayName` from two proxy headers,
  and Entra forwards `mail` for both when the display-name claim is unmapped, so the
  pair arrives identical. Four surfaces rendered that pair — the admin user row and
  its avatar, the platform-project grantee picker, and the project member picker's
  list and selected row — each with its own copy of the "show both" test, so the
  duplicate appeared in all of them. One `user-display.ts` now owns it, compared
  case-insensitively because the allowlist case-folds the UPN it materializes
  `email` from but leaves the forwarded display name as the IdP sent it.

  One authority fix falls out of the same pass: `/team/settings` decided "are you
  the owner" from `Organization.ownerId`, the only place left that read that column
  as authority. It records who created the org and can disagree with the roster —
  the `seedAcme` fixture makes it disagree on purpose — so a founder demoted to
  `admin` still saw the ownership copy and the delete-org danger zone. It reads the
  membership row now, like every other org-role gate. Both controls behind it are
  still disabled pending their endpoints, which is why this was cosmetic today and
  worth fixing before it wasn't.

## 4.12.0

### Minor Changes

- e779034: Header auth: stop rewriting a stored UPN from request headers, and detect a
  non-stripping proxy. Affects deployments running the bundled forward-auth
  provider (`SELVA_AUTH_PROVIDER=header`); no other provider is reachable by this.

  `identifyFromHeaders` no longer calls `rebindUpn` after an email-fallback match. Both
  headers on that path are proxy-supplied, so the rebind let one request repoint an
  existing allowlist row's lookup key at a caller-supplied UPN — impersonation became
  persistence, and a `.catch(() => {})` hid any failure. The fallback still adopts the
  matched row, so Entra deployments where the UPN differs from the mail address keep
  working; they resolve by email on each login rather than being rewritten after the
  first. `rebindUpn` remains on `AllowlistStore` for operator-driven correction.

  A UPN header carrying more than one value is now refused with a warning that names the
  cause. `Headers.get()` joins repeats with `", "`, which is what a proxy that fails to
  strip client-supplied copies produces. Such a request never matched an allowlist row
  anyway, so no working login changes — the warning replaces a failure that was
  indistinguishable from "user not allowlisted". The check applies to the UPN header
  only: display names legitimately contain commas.

- e779034: Give the org-owner boundary one predicate instead of three hand-written copies.

  Three routes decided whether an actor may grant or revoke org `owner`/`admin`
  standing — minting an invite, changing a member's role, and removing an owner —
  and each spelled the rule out longhand. Two had already drifted: the invite route
  let an admin mint themselves an `owner` invite, and member `DELETE` removed an
  owner that `PATCH` would not let them demote. The unguarded operation was the
  harder one to reverse; a demoted owner can be re-promoted, a removed one has lost
  every project membership to the cascade.

  `canChangeOrgRole({ actorMember, role })` now lives in `rules.ts` beside the
  project predicates, and all three routes call it. It reads the **membership
  row**, never `Organization.ownerId` — those are separate fields that can
  disagree, and only the row is authority here.

  One tightening falls out of the consolidation: the role-change branch of `PATCH
/api/v1/orgs/{orgId}/members/{userId}` now gates on both the role being granted
  and the role being taken away. Demoting an owner crosses the boundary even though
  granting `member` does not, and the old code checked only the target role.

  The point is not the deduplication. Changing that single predicate to admit
  admins turns **nine** route tests red across all three files plus two rule tests,
  from one edit — previously, breaking the rule in one route left the other two
  silently green, which is exactly how it drifted twice.

- e779034: Report projects left without an owner when an org member is removed, instead of orphaning them silently.

  `removeOrgMember` cascades every `project_members` row, so removing someone who
  was the only owner of a project left that project with nobody able to manage it —
  no settings, no roster, no delete — and nothing anywhere said so.

  Permissions.md §10 promised the removal would be **blocked** until a new owner was
  assigned. That rule is retired rather than implemented. Blocking makes the cost of
  offboarding scale with how many projects the departing person owned, which is
  backwards: the most prolific people are the ones whose departure most needs to be
  clean, and an offboarding that stalls halfway leaves a live account in the org
  while someone works through the backlog. Auto-transfer was rejected separately —
  it hands someone authority silently, by a heuristic nobody remembers, and six
  months later the audit log cannot explain why they own it.

  `DELETE /api/v1/orgs/{orgId}/members/{userId}` now emits
  `org_member.removed_orphaning_projects` carrying every affected project id in one
  event, rather than one event each: an admin reading the log wants "this
  offboarding cost three projects", not three rows to correlate. Reclaim already
  adopts an ownerless project, so the recovery path predates the problem — what was
  missing was any signal that recovery was needed.

  The check runs **before** the removal, because the cascade soft-deletes the very
  rows it reads. In the other order it finds no owners, concludes nothing was
  orphaned, and reports nothing on precisely the case it exists for — so that
  ordering has its own test.

### Patch Changes

- e779034: Admin routes adopt the shared HTTP wrapper, and two conformance tests keep both surfaces honest.

  `/api/admin/*` had zero of 22 handlers using `apiRoute`, against 40 of 43 in v1.
  That was drift rather than design, and the cause was the file path: the helpers
  lived at `api/v1/route.ts`, and a helper under a version prefix reads as
  belonging to that version. So the sibling surface hand-rolled `if (!id)
apiError(400, …)` and a per-handler `try/catch` instead. Nothing in those helpers
  was ever v1-specific; they now live at `api/http.ts`, with `api/v1/route.ts` left
  as a re-export so existing importers are untouched.

  **Two inner catches were kept deliberately.** `apiRoute` re-throws anything
  already structured, so a `apiError(409, …)` passes straight through — which means
  a `catch` mapping `ProviderError.statusCode === 409` to a typed conflict is doing
  real work. A blanket "remove every try/catch" sweep would have turned two clean
  409s into 500s. The compute routes keep theirs too: they log deliberately and
  return a specific 500. Only the `catch (err) { handleApiError(err, '…') }` tail
  that `apiRoute` now owns was deleted.

  Streaming and SSE handlers stay unwrapped on purpose — once the status line is
  sent a wrapper cannot change the response, so `apiRoute` has nothing to offer
  them and wrapping them would imply it does.

  Two new conformance checks, because nothing had ever pinned either fact:

  - **Every route handler is wrapped**, generated per route/method across both
    surfaces. The exemption list for streaming handlers has its own test: an
    exemption naming a route that no longer ships fails, so a stale exemption
    cannot silently excuse nothing.
  - **Every shipped route appears in the Permissions.md §8 matrix.** Deliberately
    one-directional — a row with no route is fine, since §8 documents unbuilt
    endpoints on purpose; only shipped-but-unlisted fails. It found 16 routes with
    no row, two rows whose path never matched a real route
    (`/api/v1/compute/solve` does not exist), and one naming the wrong permission
    (`/api/admin/system/update` was documented as `manage_updates`; the code
    requires `instance_admin`).

  Also documents `ADDRESS_HEADER` / `XFF_DEPTH` in `.env.example`. Both are read by
  `@sveltejs/adapter-node`, but the login and email-sign-in rate limiters key on
  `getClientAddress()` — behind a proxy that is the proxy's own IP for every
  request, so one noisy client can lock out the whole deployment and no per-IP
  limit means anything.

## 4.11.0

### Minor Changes

- 9eefad5: `/admin/users` and `/team/members` split along the scope they actually govern, and an invite to an existing account joins it to the org instead of failing.

  ## One surface per scope

  The two pages overlapped because `/admin/users` edited org memberships and minted org invites — work that belongs to `/team/members` under `manage_org_members`. `/admin/users` is now platform-scoped only: it lists identities, edits the four `PlatformPermission` values, and deletes users. Org role and permissions render there read-only, linking to Members & roles.

  Invites live at `/team/members` alone. The duplicate form, copy-link banner, and invites card are gone from `/admin/users`; both pages were already calling the same `/api/v1/orgs/{orgId}/invites` endpoint, so nothing moved — the second copy was deleted.

  **`PATCH /api/admin/users/[id]` no longer writes org memberships.** It gated only on `manage_instance_users` and wrote through `SYSTEM_CONTEXT`, so a caller who was not a member of the acting org and held no `manage_org_members` could still rewrite that org's permissions — including resetting an owner's — and the sole-owner invariant that `/api/v1/orgs/{orgId}/members/{userId}` enforces never ran. The body now accepts platform permissions only.

  `POST /api/admin/users` keeps attaching new users to the acting org, as a bare `member` with no permissions: under header-auth the IdP holds the credential, so there is no invite to accept and this is the only way in. Access is granted afterwards at Members & roles.

  `GET /api/admin/users` returns `platformPermissions`, `orgRole`, and `orgPermissions` instead of one merged `permissions` array. `/api/admin/*` is unversioned and internal, and its only consumer is its own page.

  ## Inviting someone who already has an account

  Accepting an invite assumed the invitee was new and always created an account, so an email that already had one hit the provider's duplicate error. The page now resolves the email first and takes a `join` mode when the account exists: no signup, just the membership. This is what multi-tenant needs — one person, one login, several orgs.

  **`join` requires a session belonging to the invitee.** The token proves the invite is genuine, not that the visitor is the person it names; for a new account that gap closes itself, because accepting is what mints the identity. An existing account has to prove it is theirs, or a forwarded link would let anyone join an org as someone else.

  Re-accepting an invite to an org you are already in consumes the invite and leaves the membership untouched. `addOrgMember` upserts in both adapters, so an unguarded accept of a `member` invite would have demoted an existing owner.

  ## One admission path per provider

  The allowlist form appeared wherever the provider implemented `createUser`, which says a provider _can_ allowlist, not that it _should_. It is now shown only where no credential-owning path exists (`createUser && !passwordAuth`).

  On Supabase that removes a second, confusing route to the same goal — and a trap: allowlisting minted a confirmed `auth.users` row with no password, so unless magic-link or OAuth happened to be configured, it created a user who could not sign in at all. Header-auth is unchanged, since allowlisting is the only way into those deployments. Where the form is hidden, the page links to Members & roles rather than offering a second invite form.

  ## "User" and "member" mean different things, and the copy now says so

  A user is an identity that can sign in; a member is one user's role and permissions inside one org. The same person is an owner of one org and a plain member of another, so a role is never a property of the person — only of the pairing. The API layers already respected this; the UI leaked across it.

  - The cross-link from `/admin/users` said `Invite user` for the button that `/team/members` calls `Invite member` — one action, two names. It mints an org invite, so it is member vocabulary.
  - The `invited` badge is now `never signed in`. It keys off `lastLoginAt`, so on an allowlisted identity no invite was ever sent; the tooltip already said "provisioned".
  - Filters read `All org roles` and `All instance permissions` rather than `All roles` and `All permissions`. Both scopes appear in one filter row, and the role one describes the acting org only — a distinction multi-tenant makes load-bearing.
  - One timestamp, one label: the roster showed `joinedAt` as either "Joined" or "Invited" depending on `lastLoginAt`, an unrelated fact. It now always reads "Joined", with "never signed in" appended separately.
  - Smaller: `Manage members` → `Manage org members` on the admin page, matching its `Manage org compute` sibling; the member PATCH toast names its object (`Member updated`) instead of a bare `Updated`; the two permission-label maps that render side by side no longer differ in casing; "teammates" and "Go to login" are gone, each having been the only occurrence of a term used differently everywhere else.

  `docs/self-hosting/concepts/permissions.md` gains the vocabulary section this was missing — it already drew the distinction most carefully, so the words live next to the model rather than in a glossary of their own. The Entra guide pointed at **Admin → Users → New user**, a control that does not exist; it now names `Allowlist user` and the org step that follows it.

## 4.10.0

### Minor Changes

- 679a24f: Invites carry instance permissions; admins no longer set another user's password.

  Creating a user had two shapes depending on the provider: an admin typed someone
  else's password (Local, Supabase), or allowlisted an email and let the IdP hold
  the credential (header-auth/Entra). The first is now gone. A provider that owns
  credentials admits users by invite, so the account holder is the only party who
  ever chooses their password.

  That removal needed a replacement first: the admin-sets-password form was the
  only way to create a second instance admin, so deleting it alone would have left
  a deployment stuck with the admin it bootstrapped with. Invites now carry
  `platformPermissions`, mintable only by a caller who already holds
  `instance_admin` — `manage_org_members` is enough to invite people, so without
  that check an org admin could mint themselves an admin invite and accept it.

  The allowlist path (`createUser`) is untouched — it is the only way into a
  header-auth deployment, and it is now the sole branch of `POST /api/admin/users`.
  The local provider implements no `createUser`, so that route reports 501 there
  and points at invites; the admin UI hides the form to match.

  In the invite form, platform permissions render as their own group. The
  owner/admin role lock renders a checkbox as checked-and-disabled, and reusing it
  across scopes would have granted `instance_admin` to every owner invite.

  Requires `supabase db push` — adds `selva.invites.platform_permissions`.

## 4.9.1

### Patch Changes

- c285409: Redirect `/login` to `/setup` on a deployment that has no instance admin yet.

  `/setup` already redirected to `/login` once an admin existed, but not the reverse — and `/login` is on the public-route allowlist, so the first-run redirect in `hooks.server.ts` skipped it. A fresh deployment therefore served a fully rendered login form on which every credential failed with "Invalid credentials", and the only way to reach the bootstrap flow was guessing the `/setup` URL. The landing page's own "Sign in" link pointed straight at it.

  The gate keys on `hasInstanceAdmin` rather than user count, matching what `/setup` uses — an OIDC provider that can't enumerate users still answers it. The form action carries the same check, so a stale or direct POST redirects instead of spending a rate-limit slot on a password that cannot exist yet.

## 4.9.0

## 4.8.2

## 4.8.1

### Patch Changes

- 6a2ed22: **Read a schema whose keys came back PascalCase, instead of rendering the definition with no inputs.**

  A compute server can return `/grasshopper/schema` with every key capitalized — `Inputs`,
  `Layout`, `SchemaVersion` — and answer 200 doing it. `Selva.gha` ILRepack-merges
  Newtonsoft, so the `[JsonProperty]` attributes on `UISchema` are a foreign type to a server
  serializing with its own Newtonsoft; it reads no attributes and falls back to raw CLR member
  names. Nothing threw — `schema.inputs` was just `undefined` everywhere, so the definition
  rendered with no inputs and the version gate silently went dead.

  `@selvajs/compute` gains `normalizeUISchemaCasing`:

  ```ts
  import { normalizeUISchemaCasing } from '@selvajs/compute/grasshopper';
  ```

  It reproduces Newtonsoft's `CamelCaseNamingStrategy` (`UVMapping` → `uvMapping`) and copies
  `options`, `defaultOptions` and `values` verbatim — those keys are the author's dropdown
  labels, and rewriting them changes what the definition solves with.

  `@selvajs/server` normalizes inside `postSchemaFormData`, so both the upload and render paths
  are covered, and adds `assertCamelCaseSchema` as a backstop for schemas persisted before this
  fix (a cached schema is re-read straight from the database). It throws `SchemaExtractionError`
  with the new `'malformed'` kind. The schema cache now also requires a readable `inputs` array,
  not just a matching version, and `mergeComputeDefaults` reports a classified error instead of
  dying on `schema.inputs.map(...)`.

  `@selvajs/selva` rejects an unreadable schema at upload (422), maps `'malformed'` to 503 as an
  operator-side problem, and no longer throws while counting inputs in the add-definition dialog.

## 4.8.0

### Minor Changes

- 4512068: The v1 API gets a definition-addressed solve, a generated OpenAPI contract that a test keeps
  honest, and one shared shape for every handler in the tree.

  ## `POST /api/v1/definitions/{guid}/solve`

  The flagship action, and what the CLI's `solve` command maps to. It shares the whole solve core
  with `POST /api/v1/compute`, which was extracted into `$lib/server/compute/solve.server.ts`.

  The core takes a `SolveAccess` discriminated union (`user` | `share`), and the definition-addressed
  route can only construct `user` — so it cannot inherit the anonymous share-token branch, even if
  someone later edits the core. Share-token resolution stays in `/api/v1/compute`'s handler.

  An unreachable definition returns **404, not 403**. A guid is guessable, so `requireCanSolve`'s 403
  on this path would tell a caller whether a definition they cannot see exists. `/api/v1/compute`
  keeps its 403 — its callers navigated to the definition rather than probing an id.

  ## Idempotency

  The endpoint accepts an optional `Idempotency-Key`. A repeat within the TTL replays the first
  response instead of solving again, and the replay carries `Idempotency-Replayed: true`.

  **The store holds a promise, reserved before the solve starts.** The common case is a client
  retrying while the first solve is still running, so the second request joins the first rather than
  starting a second one. A rejected reservation is dropped, so a failed solve stays retryable instead
  of replaying an error for the whole TTL. The key is namespaced by caller — `Idempotency-Key` is
  client-chosen, so two tenants can pick the same string.

  This absorbs retries; it is not a result cache. The TTL is a fixed 5 minutes, and the store is
  **per-process** — correct for a single-instance deployment, useless the day a second one runs.

  New in `@selvajs/server/compute`: `createIdempotencyStore`, `DEFAULT_IDEMPOTENCY_MAX_KEYS`, and the
  `IdempotencyStore` / `IdempotencyStoreConfig` / `IdempotencyOutcome` types. Bounded and timer-free
  (amortized sweep plus a hard cap, driven by the call path) so the module has no lifecycle its
  callers lack.

  ## The contract is generated and enforced

  `packages/selva/openapi/v1.yaml` describes every v1 endpoint — auth schemes, pagination, the full
  `ApiErrorCode` enum, `x-internal` tags. Regenerate with `pnpm openapi:generate`; `pnpm test` fails
  when the committed file drifts from the code.

  **Request schemas are derived from the actual Zod validators** via `z.toJSONSchema` (Zod 4 emits
  JSON Schema natively, so there is no `zod-openapi` dependency), which meant moving them somewhere a
  generator can import: `$lib/server/api/v1/bodies.ts`. Hand-transcribing them would have reproduced
  exactly the shape drift the spec exists to catch. Response schemas are deliberately **not** derived
  — handlers build payloads from store records with no validator on the way out, so the envelopes are
  described precisely and individual resource bodies left open rather than claiming precision that
  does not exist.

  A conformance test enforces the contract rather than its existence: method+path parity in both
  directions, no bare `error(...)` anywhere in the tree, every collection paginating through the
  shared parser, no documented 403 without a 404 on a guessable-id route, and a platform-permission
  guard on every `/api/admin/**` handler. That last one matters because the `/admin` layout guard
  never ran for endpoints — "all admin routes guard themselves" held only by review until now. The
  assertions were verified by breaking them: a bare `error()`, a removed admin guard, and an
  unregistered route each failed the suite by name.

  `/docs/api` renders the public subset, filtered in the load function rather than the markup so
  internal endpoints never reach the page payload. The spec itself is served at
  `/docs/api/openapi.yaml`. Both are public — an API reference behind a login is hidden from the
  people deciding whether to integrate.

  ## Every handler has the same shape

  The route tree was 2070 lines in which the interesting part sat a few lines deep, and the
  boilerplate had already drifted: path params were validated two ways (18 via `GuidSchema`, 13 via a
  manual `if (!id)`), the `try { … } catch (handleApiError) }` tail appeared 59 times, and five upload
  handlers each formatted their own "Max size: N MB".

  Shared helpers now carry it — `apiRoute`, `requireCaller`, `requireParams`, `parseParam`,
  `parseBody`, `requireUpload`, `formText`, `collection`, `created`, `noContent`, `shaped`. The tree
  is 1825 lines with none of those patterns left.

  Two of those cleanups were correctness fixes:

  **Four list endpoints ignored documented query params.** Share links, versions, invites and project
  members each hand-rolled the pagination clamp, and all four had drifted from `parseListOptions`:
  they hardcoded the default limit, dropped `Math.trunc` (so `limit=5.9` reached the store), and
  silently ignored the `orderBy`/`orderDir` the spec documents them as accepting. They now honour
  both. A conformance assertion rejects an inline clamp on any endpoint the registry calls a
  collection, so a fifth copy cannot be written.

  **Secret stripping is structural rather than conventional.** `ShareLink.tokenHash`,
  `Invite.tokenHash` and `OrgComputeServer.apiKey` were removed by destructuring, which holds until
  someone edits the line away or adds a field to the stored type — neither fails a build, and the
  result is a credential in a response. Those payloads now parse through explicit response schemas, so
  a new field on a stored record is invisible to clients until it is added deliberately.

  `PATCH /api/v1/orgs/{orgId}/compute` was the last handler validating its body by hand; it is now a
  Zod schema, so the spec derives that body too. Its `apiKey` stays `.nullable().optional()` and
  deliberately not `.nullish()` — omitted keeps the stored key, `null` clears it, a string replaces
  it, and collapsing the first two would wipe a live Rhino.Compute credential on any save that left
  the field out.

  `/docs/` joins the public route prefixes in `hooks.server.ts`.

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

- 4512068: One name, one value, for how long a solve may run. The deadline is now sourced
  from the server and carried unchanged to the browser's `AbortController`, rather
  than each layer keeping its own answer under its own name.

  **Fixed — the client could abort a solve the server would have finished.** The
  throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
  host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
  solve the server was still happily running. The user saw a failure for work that
  succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
  rather than guess it — there is no client-side default left to drift.

  **Breaking — the per-solve deadline is now required:**

  - `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
    and the options bag itself is no longer optional. The name says what elapses;
    the throttle is generic, so its field is named after a run, not a solve.
  - `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
    required.
  - `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
    the server enforces; omitting it is now a type error rather than a silent 60 s.
  - `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

  **Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
  `COMPUTE_*` namespace every other compute knob already uses, and says what it
  bounds — one solve — instead of a vague "duration". The old name still works for
  one minor version and warns at boot, so no deployment breaks on upgrade.

  **`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
  value survives the shim being dropped later instead of silently reverting to a
  default. Only the key changes — value, comments, ordering and spacing are left
  byte-identical, a commented-out old name is ignored, and the old line is dropped
  outright when the new name is already set. `.env.bak` is written alongside the
  existing backups and restored if the migration rolls back.

  `selva doctor` reports the same deprecations without changing anything, covering
  this rename plus the four that were previously silent
  (`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
  `DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
  is reported but not auto-fixed: its replacement encodes a value
  (`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

  Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
  wherever you mount `ComputeApp` or build a driver.

### Patch Changes

- 4512068: Fixed two bugs:

  - `POST /api/v1/compute/schema` reimplemented compute's fetch/error-mapping logic instead of
    reusing it. Extracted the shared part into `postSchemaFormData` (new export of
    `@selvajs/server/definitions`), used by both the single-file `fetchSchemaFromCompute` and the
    multi-file schema-preview route.
  - The admin health check's compute-reachability probe hit `/healthcheck`, a route the
    rhino.compute proxy doesn't have, so it always reported the default server as unreachable. It
    now reuses `ComputeServerStats.isServerOnline()` from `@selvajs/compute`, which probes the
    correct liveness root (`GET /`).

- 4512068: The definition viewer no longer loads the rhino3dm WASM module, and the dependency is gone from the
  app entirely.

  Curves now arrive pre-tessellated from the plugin, so the 2.5 MB module is never fetched — the
  viewer's first paint gets faster on every solve that renders geometry.

  **A definition solved by an outdated Display component now fails instead of rendering.** Curves
  from a pre-tessellation plugin carry no `points`, and the viewer surfaces an error naming the item
  rather than drawing a scene silently missing its curves. The fix is to open the definition in
  Grasshopper, run Solution → Upgrade obsolete components, and re-save.

- 4512068: **Every deprecated symbol in `@selvajs/compute` is gone.** Nothing is left as a stub — this is a
  coordinated pre-1.0 major, so there is nothing to ease.

  **`camelcaseKeys` and `toCamelCase` are removed from `@selvajs/compute/core`.** They were
  deprecated in favour of `readField`, which now takes their export slot alongside `hasField`:

  ```diff
  -import { camelcaseKeys } from '@selvajs/compute/core';
  -const { schemas } = camelcaseKeys(entry) as { schemas?: UISchema[] };
  +import { readField } from '@selvajs/compute/core';
  +const schemas = readField<UISchema[]>(entry, 'schemas');
  ```

  Blanket key-rewriting was the wrong tool for wire payloads: it corrupted user-authored keys
  (value-list labels, `Display3d` → `display3d`) while the actual problem — server branches
  disagreeing on casing for a handful of known fields — is what `readField` solves per-field.

  **If you were unwrapping compute's schema endpoint with it, you had the bug described below.**
  Use the new `readSchemaResults` instead of hand-rolling the unwrap:

  ```diff
  -const results = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as { schemas?: UISchema[] }[];
  +import { readSchemaResults } from '@selvajs/compute/grasshopper';
  +const results = readSchemaResults<UISchema>(raw);
  ```

  **`ComputeConfig.suppressClientSideWarning` is removed.** Use `suppressBrowserWarning`, which it
  has been an alias for.

  **New: `readSchemaResults` on `@selvajs/compute/grasshopper`** — the one correct way to unwrap
  `/grasshopper/schema`'s `[{ FileName, Schemas }]` body.

  It exists because everyone who hand-rolled that unwrap got it wrong the same way. The wrapper's
  casing varies by server branch (mcneel `FileName`/`Schemas`, our fork `fileName`/`schemas`), so a
  fixed-key read yields `undefined` against half of them — and the endpoint answers 200 either way,
  so the failure surfaces as "this definition has no schemas". Reaching for `camelcaseKeys` looked
  like the fix but passed the response **array** to a shallow key-rewriter, which returns arrays
  untouched: same `undefined`, now with a comment claiming it was handled.

  That was live in this repo: every upload through `/api/v1/compute/schema` 422'd with "No schemas
  found in definition". Fixed here, and `@selvajs/server/definitions` re-exports the helper typed to
  `UISchema` so the app layer keeps its concrete type.

  `readSchemaResults<TSchema>(raw)` returns `SchemaEndpointResult<TSchema>[]` — `{ schemas?, error? }`
  per file. `TSchema` is pass-through; the helper reads only the two wrapper keys and never looks
  inside a schema, so `@selvajs/compute` still doesn't depend on `@selvajs/schemas`. Pass your own
  schema type, or omit it for `unknown`.

  Also removed the unused legacy test builders (`createMockGrasshopperInput` and friends,
  `createMockThreeGeometry`) from the package's test helpers.

- 4512068: **Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
  aliases left behind. Every reference across the workspace was updated in the same commit.

  ```diff
  -import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
  +import { fetchCompute, ComputeError } from '@selvajs/compute/core';
  ```

  ```diff
  -import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
  +import type { ParamType, InputStructure } from '@selvajs/schemas';
  ```

  Both renamed schema types were already backend-agnostic in value (`ParamType` is
  `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
  just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
  data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
  via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
  so this needs a plugin rebuild.

  **`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
  export) and `@selvajs/visualization` (root deliberately empty):

  ```diff
  -import { GrasshopperClient } from '@selvajs/compute';
  +import { GrasshopperClient } from '@selvajs/compute/grasshopper';
  ```

  **Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
  operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
  (`COMPUTE_*`).

  Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
  fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
  itself is just a bare string, backend-specific by convention rather than by type).

- 4512068: Fix the library app page solving against a route that no longer exists.

  The `/api/v1` restructure moved `POST /api/compute` to `POST /api/v1/compute`, but
  `routes/library/[guid]/+page.svelte` still pointed at the old path. Every solve on a
  published definition failed with a 404 whose body was SvelteKit's HTML error page, so the
  client reported `non-JSON error body (HTTP 404)` rather than a usable message.

  The path escaped the rename because it is passed as an `endpoint` string to
  `createComputeFetchSolveFn` instead of appearing as a literal `fetch('/api/...')` call —
  worth knowing before the next route move, since a grep for fetch sites will miss it again.

  The definition-upload assertion in the `core-loop` E2E had the same stale path
  (`/api/definitions`). It waited on a response that could never arrive, so a broken upload
  would surface as a timeout instead of a failed assertion.

  Comment-only corrections to paths the restructure invalidated: the three limit fields in
  `@selvajs/server`'s `compute/limits.ts` (`/api/compute` → `/api/v1/compute`), the
  `orgDefaults` pointer in `/api/admin/compute` (`/api/org/compute` →
  `/api/v1/orgs/[orgId]/compute`), and the PATCH reference in the team-members page.

- 4512068: `@selvajs/solve/server` gains `SolveEngine`, a facade over the four primitives a consumer previously
  had to hand-assemble (`createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`,
  `runSolvePipeline`) plus the coalesce-key/abort/outcome-mapping glue every app route rewrote by hand.

  ```ts
  import { SolveEngine } from '@selvajs/solve/server';

  const engine = new SolveEngine({ limits }); // the 11-field subset of ComputeLimits it needs

  const outcome = await engine.solve({ server, definitionSource, inputs, values, signal });
  return engine.toWebResponse(outcome); // or toResponse() for a framework-agnostic {status,headers,body}
  ```

  `engine.solve()` accepts raw bytes, a string, a `DefinitionRef`, an already-built `ByteCacheRef` (from
  `engine.definitionRef()`, for a caller that needs the bytes before solving — e.g. schema extraction), or
  a `{ versionId, load }` pair that builds and caches the ref internally. `engine.stats()` aggregates
  client-cache, definition-byte-cache, and coalescing counters in one call.

  `@selvajs/solve/client` gains `createComputeFetchSolveFn`, a ready-made `SolveFn` for a
  `/api/compute`-shaped endpoint: 429 cooldown, session-expiry/redirect detection, non-JSON-response
  guarding, and abort handling at every await point, so a new consumer doesn't have to re-derive them.
  Mesh decoding stays a caller-supplied `meshes: { loadRhino, extract }` hook — the package never imports
  a renderer. Debug console telemetry defaults off; pass `debug: true` to enable it.

  `@selvajs/solve`'s TypeScript target moved ES2020 → ES2022 (matching `@selvajs/server`), enabling
  `Error(message, { cause })`.

  ## `@selvajs/selva`

  Migrated to the new facade: `clientCache.server.ts` + `definitionByteCache.server.ts` +
  `solveCache.server.ts` collapse into one `engine.server.ts` constructing a single app-wide
  `SolveEngine`; `/api/compute`'s hand-written coalesce/abort/outcome-mapping block is replaced by
  `engine.solve()` + `engine.toResponse()` (app policy — auth, DB reads, share tokens, rate limiting,
  metric recording — stays in the route, unchanged); the library page's `onSolve` closure is replaced by
  `createComputeFetchSolveFn(...)`. No public behavior change.

- 4512068: The solve core moves out of `@selvajs/server/compute` into `@selvajs/solve/server`, so the whole
  "input change → solve result" chain has one owner on both sides of the wire.

  ## Breaking — `@selvajs/server`

  **1. The solve core moved and is NOT re-exported.** Update the import path:

  ```diff
  -import { runSolvePipeline, createClientCache } from '@selvajs/server/compute';
  +import { runSolvePipeline, createClientCache } from '@selvajs/solve/server';
  ```

  Affected: `runSolvePipeline`, `adaptEnvelopeToEncoding`, `COMPUTE_CONTRACT_VERSION`,
  `COMPUTE_VERSION_HEADER`, `transformInputParameter`, `createClientCache`, `serverIdentity`,
  `createDefinitionByteCache`, `createMemorySolveResultCache`, `deriveSolveCacheInputKey`,
  `encodeSolveCacheEntry`, `decodeSolveCacheEntry`, `gunzipEntryBody`, `createSolveCacheSingleFlight`,
  and their types (`SolveOutcome`, `SolveEnvelope`, `SolvePipelineArgs`, `SolvePipelineCacheHook`,
  `SolvePhaseMetrics`, `PipelineInput`, `CachedClient`, `ByteCacheRef`, `ByteCacheStats`,
  `SolveCacheConfigSubset`, …). Add `@selvajs/solve` as a dependency.

  **2. The root export is gone.** `import … from '@selvajs/server'` no longer resolves; use a subpath:

  ```diff
  -import { resolveComputeLimits } from '@selvajs/server';
  +import { resolveComputeLimits } from '@selvajs/server/compute';
  ```

  The root barrel re-exported all nine subpaths into a single 41-symbol namespace, which hid which
  slice a consumer actually depended on. Nothing in this repo imported it.

  ## What each package owns now

  `@selvajs/server/compute` is **10 exports it owns**: `resolveComputeLimits`,
  `createComputeRateLimiter`, the SSRF guard (`isSafeRemoteDefinitionUrl` /
  `assertSafeRemoteDefinitionUrl`), `createRemoteDefinitionFetcher`, and their helpers/types. That is
  HTTP request policy — admission control and URL safety — which is a different job from running a
  solve. `@selvajs/server` no longer depends on `@selvajs/solve` at all.

  A compatibility shim was considered and rejected: it left `/compute` at 24 exports of which 14 were
  borrowed, so the package's surface no longer described what the package did — the exact problem this
  extraction exists to fix.

  ## `@selvajs/solve` — new `./server` sub-path

  Alongside `./client` and `./shared`, and still deliberately **no root barrel**. Also newly exported:
  `ByteRefOutcome` and `SolveCacheSingleFlightOptions`, which existed but were never public.

  The client/server boundary is enforced three ways: no root barrel, eslint `no-restricted-imports` on
  `src/client/**`, and a bundle test that checks the shipped `dist/client.js` for server modules,
  `process.env` reads and `node:*` imports.

- 4512068: Fix the admin update banner spinning on "PM2 is restarting the app" after an update that already succeeded.

  The runner finished, the log showed `[DONE] Update complete`, and the new process was serving — but the banner stayed up until the 5-minute deadline and then reported "App did not come back", turning a clean update into a false failure.

  - **Adds `/api/health/ready`, a real readiness probe.** The restart wait had been polling `/api/admin/system/health`, which is a _diagnostic_: it re-runs live integrity checks on every request, including a ping of the default Rhino.Compute server. So it reported non-ok whenever an unrelated dependency was down, and could take ~10s doing it — neither acceptable in a probe something waits on. The new route does the smallest thing that proves real request handling: one read through the data provider, the same call the auth hook makes on every gated request. It touches nothing external, because an unreachable compute server does not make the app unready. Public and unauthenticated (the poller runs it across a restart, when no session exists) and safe to be — the body carries a boolean and a fixed reason string, never provider data. Both probes are exact-match entries in the auth allowlist, so routes added under `/api/health/` later still inherit deny-by-default.
  - **The restart wait no longer requires the readiness probe to go green.** `pollForRestart` only accepted an outcome when the probe returned 200, so a probe that could never succeed meant a finished update could never be confirmed. Readiness is now an accelerator for the premature-online race it was added to close, not a gate: the loop also finishes on the runner's own terminal marker in the log, which is the authority on whether the update completed. A rollback still reports as a rollback; the marker carries the verdict, so the fallback can't flatten every outcome into success.
  - **A degraded (503) `/api/health` counts as reachable.** `/api/health` returns 503 with `status: "degraded"` when a boot check failed, and the poll treated any non-2xx as unreachable — so a degraded-but-serving instance stalled the wait, contradicting the rule the surrounding code already stated, that degraded must not block "online".

- 4512068: Extract parsing and rendering into a new `@selvajs/visualization` package.

  `@selvajs/compute` was doing two unrelated jobs: talking to Rhino.Compute, and turning the response
  into Three.js objects. The second job is now its own package with documented layer boundaries
  (`session → scene → render → parse → shared`, depending downward only), so a consumer can build
  their own viewer over it.

  This lands all five layers — `shared/`, `parse/`, `render/`, `scene/` and `session/`.
  **`@selvajs/compute` no longer depends on `three` in any form** (peer dep and dev deps both gone);
  it is now pure solve/data, and `@selvajs/ui` keeps only the Svelte shells plus the design system.

  **Fixed — hiding an object in the viewer now survives a solve.**

  Hiding a mesh in the scene manager and then changing an input brought it straight back: a solve
  discards all scene content and rebuilds it, and hidden state was keyed on the per-instance
  `THREE.Object3D.uuid`, which does not survive that. It is now keyed on the object's Grasshopper
  identity (`sourceComponentId` + `originalIndex`, or a display item's `id`, falling back to
  name+layer for content from older plugin versions), so it survives any number of solves. Hiding is
  also remembered when a definition edit stops producing that geometry — if it comes back, it comes
  back hidden.

  **New in `@selvajs/visualization` — `@selvajs/visualization/scene`:**

  The viewer's object list is no longer trapped in a Svelte component. `createSceneOutliner` answers
  the questions any presentation of a scene has to answer — which children are content rather than
  cameras/lights/grid, how they group by layer, what is hidden, what is selected — with no DOM:

  ```ts
  import { createSceneOutliner } from '@selvajs/visualization/scene';

  const outliner = createSceneOutliner(scene);
  outliner.searchQuery = 'wall';
  outliner.layerGroups(); // Map<layerName, Object3D[]>, search-filtered
  outliner.toggleObject(mesh); // follows a multi-selection
  outliner.select(uuid, { shiftKey, toggleKey });
  ```

  It **reads** the scene and toggles `.visible`; `updateScene` remains the sole owner of scene
  contents. Its mutable state is injectable, so a Svelte host passes `SvelteSet`s and gets reactivity
  without any subscribe/emit machinery:

  ```ts
  createSceneOutliner(scene, { sets: { hidden, selected, collapsed } });
  ```

  Hosts driving their own viewer must call `outliner.applyTo()` after each solve to re-apply hidden
  state to the rebuilt content — `<Viewer>` does this for you.

  `getSceneObjects`, `groupByLayer`, `filterLayerGroups`, `isSceneContent` and the visibility/selection
  state machines are exported individually for consumers that want the parts, not the composition.

  **New in `@selvajs/ui` — `useSolveSession`:**

  The Solve Session moved to `@selvajs/visualization/session` and is now framework-free: its state
  reads through plain getters plus a `subscribe()` seam, so it can drive a headless solve with no
  Svelte in the picture. In a component, use the new binding instead of the raw factory — it
  subscribes once and republishes as rune state, which is what keeps `session.values`/`meshes` live
  in markup:

  ```ts
  import { useSolveSession } from '@selvajs/ui';

  const driver = createRequestResponseDriver(onSolve, () => session, {
  	// `isSolving` lives on the driver, which the session can't observe — republish it.
  	onChange: () => session.notify()
  });
  const session = useSolveSession({ schema, scopeKey, driver });
  ```

  Calling `createSolveSession` directly in a component still compiles and returns correct values, but
  nothing re-renders. `@selvajs/ui` re-exports it (plus `SolveDriver`, `SolveReporter`, `SolveFn`,
  `SolveResult` and the `external/storage` helpers) from its new home, so existing imports from
  `@selvajs/ui` and `@selvajs/ui/external` keep working unchanged.

  **Breaking — `@selvajs/compute`:**

  - **`@selvajs/compute/visualization` is removed entirely.** Everything it exported now lives in
    `@selvajs/visualization`:

    | Was                                                                                                                                                                                                   | Now                                                                         |
    | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
    | `initThree`, `updateScene`, camera, grid, gizmo, edges, labels, measure, render pipeline, materials, up-axis helpers                                                                                  | `@selvajs/visualization/render`                                             |
    | `getThreeMeshesFromComputeResponse`, `parseMeshBatch{,Object,Blob}`, `parseBinaryMeshBatch`, `parseDisplayItems`, texture cache, wire-format constants (`BINARY_MESH_MAGIC`, `FLAG_*`, `UV_FORMAT_*`) | `@selvajs/visualization/parse`                                              |
    | `LOOKS`, `Look`, `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                                                                                                            | `@selvajs/visualization/shared` (also re-exported from `/render`)           |
    | `createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`, `SolveFn`, `SolveResult`, `createComputeThrottle`, `createSolveMemo`, the `external/storage` helpers             | `@selvajs/visualization/session` (all still re-exported from `@selvajs/ui`) |

  - `GrasshopperResponseProcessor.extractMeshesFromResponse()` is **removed**. It coupled the solve
    client to a renderer, which the new layering forbids. Its `response` and `debug` fields are now
    public, so call the parser directly:

    ```ts
    import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';

    const meshes = await getThreeMeshesFromComputeResponse(processor.response, { rhino });
    ```

  - `initThree` no longer reaches into the texture cache itself — `render/` must not import `parse/`.
    To keep color maps sharp at grazing angles, wire the new `onMaxAnisotropy` option:

    ```ts
    import { setTextureAnisotropy } from '@selvajs/visualization/parse';

    initThree(canvas, { onMaxAnisotropy: setTextureAnisotropy });
    ```

    Omitted, textures keep three's default anisotropy of 1 — sharpness regresses, nothing breaks.

  - `decodeBase64ToBinary` is now exported from the package root (the binary mesh parser needs it, and
    its forgiving-base64 normalization plus Node pool-slab copy are too subtle to duplicate).

  **Also in this change:** the five largest files were split along the seams they already had, with no
  behavior change. `three-initializer` 1743→407 (`scene-setup/*`, 14 files — the `ThreeViewer` handle,
  the postprocessing pipeline and the runtime appearance setters each became their own module),
  `edges` 874→233 (`edges/{options,extraction,cache,overlay}.ts`), `batch-parser` 1007→466
  (`batch/{metadata,materials,merge,assembly-worker}.ts`), `binary-parser` 713→329
  (`binary/{header,geometry,textures}.ts`), `display-items-parser` 440→77
  (`items/{curves,points,appearance}.ts`), the session's driver split out into
  `session/drivers/{driver,request-response}.ts`, and `SceneManager.svelte` 319→234 (its logic now in
  `scene/`). 425 tests pass.

## 4.8.0-beta.14

## 4.8.0-beta.13

## 4.8.0-beta.12

### Patch Changes

- 12fa352: Fix the admin update banner spinning on "PM2 is restarting the app" after an update that already succeeded.

  The runner finished, the log showed `[DONE] Update complete`, and the new process was serving — but the banner stayed up until the 5-minute deadline and then reported "App did not come back", turning a clean update into a false failure.

  - **Adds `/api/health/ready`, a real readiness probe.** The restart wait had been polling `/api/admin/system/health`, which is a _diagnostic_: it re-runs live integrity checks on every request, including a ping of the default Rhino.Compute server. So it reported non-ok whenever an unrelated dependency was down, and could take ~10s doing it — neither acceptable in a probe something waits on. The new route does the smallest thing that proves real request handling: one read through the data provider, the same call the auth hook makes on every gated request. It touches nothing external, because an unreachable compute server does not make the app unready. Public and unauthenticated (the poller runs it across a restart, when no session exists) and safe to be — the body carries a boolean and a fixed reason string, never provider data. Both probes are exact-match entries in the auth allowlist, so routes added under `/api/health/` later still inherit deny-by-default.
  - **The restart wait no longer requires the readiness probe to go green.** `pollForRestart` only accepted an outcome when the probe returned 200, so a probe that could never succeed meant a finished update could never be confirmed. Readiness is now an accelerator for the premature-online race it was added to close, not a gate: the loop also finishes on the runner's own terminal marker in the log, which is the authority on whether the update completed. A rollback still reports as a rollback; the marker carries the verdict, so the fallback can't flatten every outcome into success.
  - **A degraded (503) `/api/health` counts as reachable.** `/api/health` returns 503 with `status: "degraded"` when a boot check failed, and the poll treated any non-2xx as unreachable — so a degraded-but-serving instance stalled the wait, contradicting the rule the surrounding code already stated, that degraded must not block "online".

## 4.8.0-beta.11

## 4.8.0-beta.10

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

## 4.8.0-beta.9

## 4.8.0-beta.8

## 4.8.0-beta.7

### Patch Changes

- 28944ae: Fixed two bugs:

  - `POST /api/v1/compute/schema` reimplemented compute's fetch/error-mapping logic instead of
    reusing it. Extracted the shared part into `postSchemaFormData` (new export of
    `@selvajs/server/definitions`), used by both the single-file `fetchSchemaFromCompute` and the
    multi-file schema-preview route.
  - The admin health check's compute-reachability probe hit `/healthcheck`, a route the
    rhino.compute proxy doesn't have, so it always reported the default server as unreachable. It
    now reuses `ComputeServerStats.isServerOnline()` from `@selvajs/compute`, which probes the
    correct liveness root (`GET /`).

## 4.8.0-beta.6

### Patch Changes

- 5292563: **Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
  aliases left behind. Every reference across the workspace was updated in the same commit.

  ```diff
  -import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
  +import { fetchCompute, ComputeError } from '@selvajs/compute/core';
  ```

  ```diff
  -import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
  +import type { ParamType, InputStructure } from '@selvajs/schemas';
  ```

  Both renamed schema types were already backend-agnostic in value (`ParamType` is
  `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
  just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
  data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
  via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
  so this needs a plugin rebuild.

  **`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
  export) and `@selvajs/visualization` (root deliberately empty):

  ```diff
  -import { GrasshopperClient } from '@selvajs/compute';
  +import { GrasshopperClient } from '@selvajs/compute/grasshopper';
  ```

  **Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
  operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
  (`COMPUTE_*`).

  Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
  fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
  itself is just a bare string, backend-specific by convention rather than by type).

## 4.8.0-beta.5

### Patch Changes

- 9f60b66: The definition viewer no longer loads the rhino3dm WASM module, and the dependency is gone from the
  app entirely.

  Curves now arrive pre-tessellated from the plugin, so the 2.5 MB module is never fetched — the
  viewer's first paint gets faster on every solve that renders geometry.

  **A definition solved by an outdated Display component now fails instead of rendering.** Curves
  from a pre-tessellation plugin carry no `points`, and the viewer surfaces an error naming the item
  rather than drawing a scene silently missing its curves. The fix is to open the definition in
  Grasshopper, run Solution → Upgrade obsolete components, and re-save.

- 9f60b66: **Every deprecated symbol in `@selvajs/compute` is gone.** Nothing is left as a stub — this is a
  coordinated pre-1.0 major, so there is nothing to ease.

  **`camelcaseKeys` and `toCamelCase` are removed from `@selvajs/compute/core`.** They were
  deprecated in favour of `readField`, which now takes their export slot alongside `hasField`:

  ```diff
  -import { camelcaseKeys } from '@selvajs/compute/core';
  -const { schemas } = camelcaseKeys(entry) as { schemas?: UISchema[] };
  +import { readField } from '@selvajs/compute/core';
  +const schemas = readField<UISchema[]>(entry, 'schemas');
  ```

  Blanket key-rewriting was the wrong tool for wire payloads: it corrupted user-authored keys
  (value-list labels, `Display3d` → `display3d`) while the actual problem — server branches
  disagreeing on casing for a handful of known fields — is what `readField` solves per-field.

  **If you were unwrapping compute's schema endpoint with it, you had the bug described below.**
  Use the new `readSchemaResults` instead of hand-rolling the unwrap:

  ```diff
  -const results = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as { schemas?: UISchema[] }[];
  +import { readSchemaResults } from '@selvajs/compute/grasshopper';
  +const results = readSchemaResults<UISchema>(raw);
  ```

  **`ComputeConfig.suppressClientSideWarning` is removed.** Use `suppressBrowserWarning`, which it
  has been an alias for.

  **New: `readSchemaResults` on `@selvajs/compute/grasshopper`** — the one correct way to unwrap
  `/grasshopper/schema`'s `[{ FileName, Schemas }]` body.

  It exists because everyone who hand-rolled that unwrap got it wrong the same way. The wrapper's
  casing varies by server branch (mcneel `FileName`/`Schemas`, our fork `fileName`/`schemas`), so a
  fixed-key read yields `undefined` against half of them — and the endpoint answers 200 either way,
  so the failure surfaces as "this definition has no schemas". Reaching for `camelcaseKeys` looked
  like the fix but passed the response **array** to a shallow key-rewriter, which returns arrays
  untouched: same `undefined`, now with a comment claiming it was handled.

  That was live in this repo: every upload through `/api/v1/compute/schema` 422'd with "No schemas
  found in definition". Fixed here, and `@selvajs/server/definitions` re-exports the helper typed to
  `UISchema` so the app layer keeps its concrete type.

  `readSchemaResults<TSchema>(raw)` returns `SchemaEndpointResult<TSchema>[]` — `{ schemas?, error? }`
  per file. `TSchema` is pass-through; the helper reads only the two wrapper keys and never looks
  inside a schema, so `@selvajs/compute` still doesn't depend on `@selvajs/schemas`. Pass your own
  schema type, or omit it for `unknown`.

  Also removed the unused legacy test builders (`createMockGrasshopperInput` and friends,
  `createMockThreeGeometry`) from the package's test helpers.

## 4.8.0-beta.4

### Patch Changes

- 2cc44d3: Fix the library app page solving against a route that no longer exists.

  The `/api/v1` restructure moved `POST /api/compute` to `POST /api/v1/compute`, but
  `routes/library/[guid]/+page.svelte` still pointed at the old path. Every solve on a
  published definition failed with a 404 whose body was SvelteKit's HTML error page, so the
  client reported `non-JSON error body (HTTP 404)` rather than a usable message.

  The path escaped the rename because it is passed as an `endpoint` string to
  `createComputeFetchSolveFn` instead of appearing as a literal `fetch('/api/...')` call —
  worth knowing before the next route move, since a grep for fetch sites will miss it again.

  The definition-upload assertion in the `core-loop` E2E had the same stale path
  (`/api/definitions`). It waited on a response that could never arrive, so a broken upload
  would surface as a timeout instead of a failed assertion.

  Comment-only corrections to paths the restructure invalidated: the three limit fields in
  `@selvajs/server`'s `compute/limits.ts` (`/api/compute` → `/api/v1/compute`), the
  `orgDefaults` pointer in `/api/admin/compute` (`/api/org/compute` →
  `/api/v1/orgs/[orgId]/compute`), and the PATCH reference in the team-members page.

## 4.8.0-beta.3

### Minor Changes

- 3485634: The v1 API gets a definition-addressed solve, a generated OpenAPI contract that a test keeps
  honest, and one shared shape for every handler in the tree.

  ## `POST /api/v1/definitions/{guid}/solve`

  The flagship action, and what the CLI's `solve` command maps to. It shares the whole solve core
  with `POST /api/v1/compute`, which was extracted into `$lib/server/compute/solve.server.ts`.

  The core takes a `SolveAccess` discriminated union (`user` | `share`), and the definition-addressed
  route can only construct `user` — so it cannot inherit the anonymous share-token branch, even if
  someone later edits the core. Share-token resolution stays in `/api/v1/compute`'s handler.

  An unreachable definition returns **404, not 403**. A guid is guessable, so `requireCanSolve`'s 403
  on this path would tell a caller whether a definition they cannot see exists. `/api/v1/compute`
  keeps its 403 — its callers navigated to the definition rather than probing an id.

  ## Idempotency

  The endpoint accepts an optional `Idempotency-Key`. A repeat within the TTL replays the first
  response instead of solving again, and the replay carries `Idempotency-Replayed: true`.

  **The store holds a promise, reserved before the solve starts.** The common case is a client
  retrying while the first solve is still running, so the second request joins the first rather than
  starting a second one. A rejected reservation is dropped, so a failed solve stays retryable instead
  of replaying an error for the whole TTL. The key is namespaced by caller — `Idempotency-Key` is
  client-chosen, so two tenants can pick the same string.

  This absorbs retries; it is not a result cache. The TTL is a fixed 5 minutes, and the store is
  **per-process** — correct for a single-instance deployment, useless the day a second one runs.

  New in `@selvajs/server/compute`: `createIdempotencyStore`, `DEFAULT_IDEMPOTENCY_MAX_KEYS`, and the
  `IdempotencyStore` / `IdempotencyStoreConfig` / `IdempotencyOutcome` types. Bounded and timer-free
  (amortized sweep plus a hard cap, driven by the call path) so the module has no lifecycle its
  callers lack.

  ## The contract is generated and enforced

  `packages/selva/openapi/v1.yaml` describes every v1 endpoint — auth schemes, pagination, the full
  `ApiErrorCode` enum, `x-internal` tags. Regenerate with `pnpm openapi:generate`; `pnpm test` fails
  when the committed file drifts from the code.

  **Request schemas are derived from the actual Zod validators** via `z.toJSONSchema` (Zod 4 emits
  JSON Schema natively, so there is no `zod-openapi` dependency), which meant moving them somewhere a
  generator can import: `$lib/server/api/v1/bodies.ts`. Hand-transcribing them would have reproduced
  exactly the shape drift the spec exists to catch. Response schemas are deliberately **not** derived
  — handlers build payloads from store records with no validator on the way out, so the envelopes are
  described precisely and individual resource bodies left open rather than claiming precision that
  does not exist.

  A conformance test enforces the contract rather than its existence: method+path parity in both
  directions, no bare `error(...)` anywhere in the tree, every collection paginating through the
  shared parser, no documented 403 without a 404 on a guessable-id route, and a platform-permission
  guard on every `/api/admin/**` handler. That last one matters because the `/admin` layout guard
  never ran for endpoints — "all admin routes guard themselves" held only by review until now. The
  assertions were verified by breaking them: a bare `error()`, a removed admin guard, and an
  unregistered route each failed the suite by name.

  `/docs/api` renders the public subset, filtered in the load function rather than the markup so
  internal endpoints never reach the page payload. The spec itself is served at
  `/docs/api/openapi.yaml`. Both are public — an API reference behind a login is hidden from the
  people deciding whether to integrate.

  ## Every handler has the same shape

  The route tree was 2070 lines in which the interesting part sat a few lines deep, and the
  boilerplate had already drifted: path params were validated two ways (18 via `GuidSchema`, 13 via a
  manual `if (!id)`), the `try { … } catch (handleApiError) }` tail appeared 59 times, and five upload
  handlers each formatted their own "Max size: N MB".

  Shared helpers now carry it — `apiRoute`, `requireCaller`, `requireParams`, `parseParam`,
  `parseBody`, `requireUpload`, `formText`, `collection`, `created`, `noContent`, `shaped`. The tree
  is 1825 lines with none of those patterns left.

  Two of those cleanups were correctness fixes:

  **Four list endpoints ignored documented query params.** Share links, versions, invites and project
  members each hand-rolled the pagination clamp, and all four had drifted from `parseListOptions`:
  they hardcoded the default limit, dropped `Math.trunc` (so `limit=5.9` reached the store), and
  silently ignored the `orderBy`/`orderDir` the spec documents them as accepting. They now honour
  both. A conformance assertion rejects an inline clamp on any endpoint the registry calls a
  collection, so a fifth copy cannot be written.

  **Secret stripping is structural rather than conventional.** `ShareLink.tokenHash`,
  `Invite.tokenHash` and `OrgComputeServer.apiKey` were removed by destructuring, which holds until
  someone edits the line away or adds a field to the stored type — neither fails a build, and the
  result is a credential in a response. Those payloads now parse through explicit response schemas, so
  a new field on a stored record is invisible to clients until it is added deliberately.

  `PATCH /api/v1/orgs/{orgId}/compute` was the last handler validating its body by hand; it is now a
  Zod schema, so the spec derives that body too. Its `apiKey` stays `.nullable().optional()` and
  deliberately not `.nullish()` — omitted keeps the stored key, `null` clears it, a string replaces
  it, and collapsing the first two would wipe a live Rhino.Compute credential on any save that left
  the field out.

  `/docs/` joins the public route prefixes in `hooks.server.ts`.

## 4.8.0-beta.2

### Minor Changes

- b9c9d6a: One name, one value, for how long a solve may run. The deadline is now sourced
  from the server and carried unchanged to the browser's `AbortController`, rather
  than each layer keeping its own answer under its own name.

  **Fixed — the client could abort a solve the server would have finished.** The
  throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
  host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
  solve the server was still happily running. The user saw a failure for work that
  succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
  rather than guess it — there is no client-side default left to drift.

  **Breaking — the per-solve deadline is now required:**

  - `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
    and the options bag itself is no longer optional. The name says what elapses;
    the throttle is generic, so its field is named after a run, not a solve.
  - `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
    required.
  - `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
    the server enforces; omitting it is now a type error rather than a silent 60 s.
  - `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

  **Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
  `COMPUTE_*` namespace every other compute knob already uses, and says what it
  bounds — one solve — instead of a vague "duration". The old name still works for
  one minor version and warns at boot, so no deployment breaks on upgrade.

  **`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
  value survives the shim being dropped later instead of silently reverting to a
  default. Only the key changes — value, comments, ordering and spacing are left
  byte-identical, a commented-out old name is ignored, and the old line is dropped
  outright when the new name is already set. `.env.bak` is written alongside the
  existing backups and restored if the migration rolls back.

  `selva doctor` reports the same deprecations without changing anything, covering
  this rename plus the four that were previously silent
  (`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
  `DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
  is reported but not auto-fixed: its replacement encodes a value
  (`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

  Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
  wherever you mount `ComputeApp` or build a driver.

## 4.7.4-beta.1

### Patch Changes

- 105275c: `@selvajs/solve/server` gains `SolveEngine`, a facade over the four primitives a consumer previously
  had to hand-assemble (`createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`,
  `runSolvePipeline`) plus the coalesce-key/abort/outcome-mapping glue every app route rewrote by hand.

  ```ts
  import { SolveEngine } from '@selvajs/solve/server';

  const engine = new SolveEngine({ limits }); // the 11-field subset of ComputeLimits it needs

  const outcome = await engine.solve({ server, definitionSource, inputs, values, signal });
  return engine.toWebResponse(outcome); // or toResponse() for a framework-agnostic {status,headers,body}
  ```

  `engine.solve()` accepts raw bytes, a string, a `DefinitionRef`, an already-built `ByteCacheRef` (from
  `engine.definitionRef()`, for a caller that needs the bytes before solving — e.g. schema extraction), or
  a `{ versionId, load }` pair that builds and caches the ref internally. `engine.stats()` aggregates
  client-cache, definition-byte-cache, and coalescing counters in one call.

  `@selvajs/solve/client` gains `createComputeFetchSolveFn`, a ready-made `SolveFn` for a
  `/api/compute`-shaped endpoint: 429 cooldown, session-expiry/redirect detection, non-JSON-response
  guarding, and abort handling at every await point, so a new consumer doesn't have to re-derive them.
  Mesh decoding stays a caller-supplied `meshes: { loadRhino, extract }` hook — the package never imports
  a renderer. Debug console telemetry defaults off; pass `debug: true` to enable it.

  `@selvajs/solve`'s TypeScript target moved ES2020 → ES2022 (matching `@selvajs/server`), enabling
  `Error(message, { cause })`.

  ## `@selvajs/selva`

  Migrated to the new facade: `clientCache.server.ts` + `definitionByteCache.server.ts` +
  `solveCache.server.ts` collapse into one `engine.server.ts` constructing a single app-wide
  `SolveEngine`; `/api/compute`'s hand-written coalesce/abort/outcome-mapping block is replaced by
  `engine.solve()` + `engine.toResponse()` (app policy — auth, DB reads, share tokens, rate limiting,
  metric recording — stays in the route, unchanged); the library page's `onSolve` closure is replaced by
  `createComputeFetchSolveFn(...)`. No public behavior change.

## 4.7.4-beta.0

### Patch Changes

- 49cac15: The solve core moves out of `@selvajs/server/compute` into `@selvajs/solve/server`, so the whole
  "input change → solve result" chain has one owner on both sides of the wire.

  ## Breaking — `@selvajs/server`

  **1. The solve core moved and is NOT re-exported.** Update the import path:

  ```diff
  -import { runSolvePipeline, createClientCache } from '@selvajs/server/compute';
  +import { runSolvePipeline, createClientCache } from '@selvajs/solve/server';
  ```

  Affected: `runSolvePipeline`, `adaptEnvelopeToEncoding`, `COMPUTE_CONTRACT_VERSION`,
  `COMPUTE_VERSION_HEADER`, `transformInputParameter`, `createClientCache`, `serverIdentity`,
  `createDefinitionByteCache`, `createMemorySolveResultCache`, `deriveSolveCacheInputKey`,
  `encodeSolveCacheEntry`, `decodeSolveCacheEntry`, `gunzipEntryBody`, `createSolveCacheSingleFlight`,
  and their types (`SolveOutcome`, `SolveEnvelope`, `SolvePipelineArgs`, `SolvePipelineCacheHook`,
  `SolvePhaseMetrics`, `PipelineInput`, `CachedClient`, `ByteCacheRef`, `ByteCacheStats`,
  `SolveCacheConfigSubset`, …). Add `@selvajs/solve` as a dependency.

  **2. The root export is gone.** `import … from '@selvajs/server'` no longer resolves; use a subpath:

  ```diff
  -import { resolveComputeLimits } from '@selvajs/server';
  +import { resolveComputeLimits } from '@selvajs/server/compute';
  ```

  The root barrel re-exported all nine subpaths into a single 41-symbol namespace, which hid which
  slice a consumer actually depended on. Nothing in this repo imported it.

  ## What each package owns now

  `@selvajs/server/compute` is **10 exports it owns**: `resolveComputeLimits`,
  `createComputeRateLimiter`, the SSRF guard (`isSafeRemoteDefinitionUrl` /
  `assertSafeRemoteDefinitionUrl`), `createRemoteDefinitionFetcher`, and their helpers/types. That is
  HTTP request policy — admission control and URL safety — which is a different job from running a
  solve. `@selvajs/server` no longer depends on `@selvajs/solve` at all.

  A compatibility shim was considered and rejected: it left `/compute` at 24 exports of which 14 were
  borrowed, so the package's surface no longer described what the package did — the exact problem this
  extraction exists to fix.

  ## `@selvajs/solve` — new `./server` sub-path

  Alongside `./client` and `./shared`, and still deliberately **no root barrel**. Also newly exported:
  `ByteRefOutcome` and `SolveCacheSingleFlightOptions`, which existed but were never public.

  The client/server boundary is enforced three ways: no root barrel, eslint `no-restricted-imports` on
  `src/client/**`, and a bundle test that checks the shipped `dist/client.js` for server modules,
  `process.env` reads and `node:*` imports.

- 7751bd0: Extract parsing and rendering into a new `@selvajs/visualization` package.

  `@selvajs/compute` was doing two unrelated jobs: talking to Rhino.Compute, and turning the response
  into Three.js objects. The second job is now its own package with documented layer boundaries
  (`session → scene → render → parse → shared`, depending downward only), so a consumer can build
  their own viewer over it.

  This lands all five layers — `shared/`, `parse/`, `render/`, `scene/` and `session/`.
  **`@selvajs/compute` no longer depends on `three` in any form** (peer dep and dev deps both gone);
  it is now pure solve/data, and `@selvajs/ui` keeps only the Svelte shells plus the design system.

  **Fixed — hiding an object in the viewer now survives a solve.**

  Hiding a mesh in the scene manager and then changing an input brought it straight back: a solve
  discards all scene content and rebuilds it, and hidden state was keyed on the per-instance
  `THREE.Object3D.uuid`, which does not survive that. It is now keyed on the object's Grasshopper
  identity (`sourceComponentId` + `originalIndex`, or a display item's `id`, falling back to
  name+layer for content from older plugin versions), so it survives any number of solves. Hiding is
  also remembered when a definition edit stops producing that geometry — if it comes back, it comes
  back hidden.

  **New in `@selvajs/visualization` — `@selvajs/visualization/scene`:**

  The viewer's object list is no longer trapped in a Svelte component. `createSceneOutliner` answers
  the questions any presentation of a scene has to answer — which children are content rather than
  cameras/lights/grid, how they group by layer, what is hidden, what is selected — with no DOM:

  ```ts
  import { createSceneOutliner } from '@selvajs/visualization/scene';

  const outliner = createSceneOutliner(scene);
  outliner.searchQuery = 'wall';
  outliner.layerGroups(); // Map<layerName, Object3D[]>, search-filtered
  outliner.toggleObject(mesh); // follows a multi-selection
  outliner.select(uuid, { shiftKey, toggleKey });
  ```

  It **reads** the scene and toggles `.visible`; `updateScene` remains the sole owner of scene
  contents. Its mutable state is injectable, so a Svelte host passes `SvelteSet`s and gets reactivity
  without any subscribe/emit machinery:

  ```ts
  createSceneOutliner(scene, { sets: { hidden, selected, collapsed } });
  ```

  Hosts driving their own viewer must call `outliner.applyTo()` after each solve to re-apply hidden
  state to the rebuilt content — `<Viewer>` does this for you.

  `getSceneObjects`, `groupByLayer`, `filterLayerGroups`, `isSceneContent` and the visibility/selection
  state machines are exported individually for consumers that want the parts, not the composition.

  **New in `@selvajs/ui` — `useSolveSession`:**

  The Solve Session moved to `@selvajs/visualization/session` and is now framework-free: its state
  reads through plain getters plus a `subscribe()` seam, so it can drive a headless solve with no
  Svelte in the picture. In a component, use the new binding instead of the raw factory — it
  subscribes once and republishes as rune state, which is what keeps `session.values`/`meshes` live
  in markup:

  ```ts
  import { useSolveSession } from '@selvajs/ui';

  const driver = createRequestResponseDriver(onSolve, () => session, {
  	// `isSolving` lives on the driver, which the session can't observe — republish it.
  	onChange: () => session.notify()
  });
  const session = useSolveSession({ schema, scopeKey, driver });
  ```

  Calling `createSolveSession` directly in a component still compiles and returns correct values, but
  nothing re-renders. `@selvajs/ui` re-exports it (plus `SolveDriver`, `SolveReporter`, `SolveFn`,
  `SolveResult` and the `external/storage` helpers) from its new home, so existing imports from
  `@selvajs/ui` and `@selvajs/ui/external` keep working unchanged.

  **Breaking — `@selvajs/compute`:**

  - **`@selvajs/compute/visualization` is removed entirely.** Everything it exported now lives in
    `@selvajs/visualization`:

    | Was                                                                                                                                                                                                   | Now                                                                         |
    | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
    | `initThree`, `updateScene`, camera, grid, gizmo, edges, labels, measure, render pipeline, materials, up-axis helpers                                                                                  | `@selvajs/visualization/render`                                             |
    | `getThreeMeshesFromComputeResponse`, `parseMeshBatch{,Object,Blob}`, `parseBinaryMeshBatch`, `parseDisplayItems`, texture cache, wire-format constants (`BINARY_MESH_MAGIC`, `FLAG_*`, `UV_FORMAT_*`) | `@selvajs/visualization/parse`                                              |
    | `LOOKS`, `Look`, `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                                                                                                            | `@selvajs/visualization/shared` (also re-exported from `/render`)           |
    | `createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`, `SolveFn`, `SolveResult`, `createComputeThrottle`, `createSolveMemo`, the `external/storage` helpers             | `@selvajs/visualization/session` (all still re-exported from `@selvajs/ui`) |

  - `GrasshopperResponseProcessor.extractMeshesFromResponse()` is **removed**. It coupled the solve
    client to a renderer, which the new layering forbids. Its `response` and `debug` fields are now
    public, so call the parser directly:

    ```ts
    import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';

    const meshes = await getThreeMeshesFromComputeResponse(processor.response, { rhino });
    ```

  - `initThree` no longer reaches into the texture cache itself — `render/` must not import `parse/`.
    To keep color maps sharp at grazing angles, wire the new `onMaxAnisotropy` option:

    ```ts
    import { setTextureAnisotropy } from '@selvajs/visualization/parse';

    initThree(canvas, { onMaxAnisotropy: setTextureAnisotropy });
    ```

    Omitted, textures keep three's default anisotropy of 1 — sharpness regresses, nothing breaks.

  - `decodeBase64ToBinary` is now exported from the package root (the binary mesh parser needs it, and
    its forgiving-base64 normalization plus Node pool-slab copy are too subtle to duplicate).

  **Also in this change:** the five largest files were split along the seams they already had, with no
  behavior change. `three-initializer` 1743→407 (`scene-setup/*`, 14 files — the `ThreeViewer` handle,
  the postprocessing pipeline and the runtime appearance setters each became their own module),
  `edges` 874→233 (`edges/{options,extraction,cache,overlay}.ts`), `batch-parser` 1007→466
  (`batch/{metadata,materials,merge,assembly-worker}.ts`), `binary-parser` 713→329
  (`binary/{header,geometry,textures}.ts`), `display-items-parser` 440→77
  (`items/{curves,points,appearance}.ts`), the session's driver split out into
  `session/drivers/{driver,request-response}.ts`, and `SceneManager.svelte` 319→234 (its logic now in
  `scene/`). 425 tests pass.

## 4.7.3

### Patch Changes

- 0d503c6: Update `rhino3dm` from 8.17.0 to 8.32.0.

  No API surface used by Selva changed. The upgrade was verified by loading both
  WASM modules side by side and diffing their runtime surfaces: `CommonObject.decode`,
  `Point`, `Line`, `Curve.isPolyline`/`tryGetPolyline`, `getBoundingBox`, and the
  emscripten `delete()`/`isDeleted()` lifecycle are all unchanged. 8.32.0 is a strict
  superset — it adds `BrepLoop`/`BrepTrim` topology classes, SubD iterators,
  `Material.setTexture`, and `Mesh.toThreejsBuffers`, none of which the current
  pipeline uses. The 16 dropped top-level exports are emscripten internals
  (`HEAPU8`, `_malloc`, `ready`) that nothing references.

  Both documented runtime quirks the display-item parser works around still hold in
  8.32.0, so the workarounds stay: `tryGetPolyline` returns the `Polyline` directly
  rather than the `[ok, Polyline]` tuple its type declares, and `getBoundingBox`
  takes no arguments at runtime despite its `.d.ts` signature.

  The package still ships no `exports` field, so plugin-ui's
  `rhino3dm/rhino3dm.wasm?url` Vite asset import keeps resolving; the emitted bundle
  was confirmed byte-identical to the 8.32.0 WASM. One source-breaking type change
  exists but is unused here — `File3dm.add*` methods (`addMesh`, `addCurve`, …) now
  require a second `attributes` argument.

## 4.7.2

### Patch Changes

- 3b787ff: Fix the project settings dialog overflowing the viewport when a project has many
  members, and rework its layout so the added height is used deliberately.

  **The dialog had no height bound.** `Dialog.Content` renders as a grid with
  auto-sized rows and no `max-height`, so the members list grew with the member
  count and pushed the dialog past the top and bottom of the screen — with 60+
  members, the tab bar and the "Add member" button were both unreachable. The
  dialog is now a flex column capped at `calc(100dvh-2rem)`, the tab area has a
  fixed shared height, and only the member list scrolls. Both tabs occupy the same
  box, so switching between them no longer resizes the dialog.

  **Member rows overflowed horizontally.** The avatar, role `<select>`, and remove
  button had no `shrink-0`, so a long display name or an unbroken email string
  stretched the row instead of truncating, pushing the role control off the right
  edge. Those controls now hold their width and the name column absorbs the
  squeeze, so `truncate` applies as intended.

  **Layout rework.** Delete/Cancel/Save moved out of the scrollable General form
  into a pinned footer shared by both tabs, so the actions no longer scroll away
  with the form. The description textarea grew from 2 to 5 rows, and the Visibility
  options are now short labels (Public/Org/Private) with the explanation moved to
  helper text below the select.

  Also fixes a pre-existing bug surfaced by that rework: `ProjectVisibility`
  includes a fourth `platform` variant that the select never offered, so opening a
  platform-visibility project showed a select with no matching option and saving
  silently coerced it to `public`. `platform` is now preserved as a conditional
  option when already set. It stays absent from the list otherwise, since that
  visibility is granted by platform admins rather than chosen here.

## 4.7.1

### Patch Changes

- 650ef18: Fix two live defects in `SupabaseAuthProvider`: disabled users could refresh
  sessions indefinitely, and `last_login_at` never updated.

  **`refreshSession` did not check `disabled`.** `signIn`, `exchangeOAuthCode`, and
  `verifyMagicLink` all reject users flagged `user_metadata.disabled === true`;
  `refreshSession` did not. This was not a latent gap — the session-refresh
  middleware in `hooks.server.ts` calls it on every request where `verifyToken`
  fails, so a disabled user's expired access token was silently swapped for a
  fresh one on the next request, forever. The `revalidateMs` revocation bound on
  `verifyToken` never applied, because that path had already failed by the time
  refresh ran. Disabling a user now takes effect within one access-token lifetime
  on the refresh path. GoTrue already returns the user alongside the session, so
  the check costs no extra round-trip.

  **`touchLastLogin` wrote to the wrong schema.** Engine tables live in the `selva`
  schema, and every client in `data/client.ts` pins `db: { schema: 'selva' }`. The
  auth provider's service-role client was constructed without that option, so it
  resolved `user_profiles` against `public` — where the table does not exist.
  PostgREST returned a relation-not-found error, and the unchecked `await`
  swallowed it, so `last_login_at` silently never updated in any Supabase
  deployment. Table access now goes through a schema-pinned client, and a failed
  stamp is logged rather than discarded. The write stays best-effort and still
  never throws, per the `IAuthProvider.touchLastLogin` contract.

  `this.admin` is deliberately left unpinned: it drives `auth.admin.*`, which is
  GoTrue's own REST surface and unaffected by the PostgREST schema setting.

  `SupabaseAuthProvider.fromEnv` now accepts an optional second `ILogger`
  argument, matching `HeaderAuthProvider.fromEnv`. Purely additive — omitting it
  keeps the previous `NoopLogger` behavior. `@selvajs/selva` passes its
  `lazyLogger` through, so the failure above is actually visible in the app
  rather than swallowed.

## 4.7.0

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

- 5077fe9: Adding advanced caching
- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

- 594b5ad: Adding advanced caching

### Patch Changes

- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- 2673995: Extract the configurable provider wiring into `@selvajs/server/providers` (embeddable-server-layer K5):

  - **`createSelvaProviders(env, options)`** — the reusable core of the app's composition root: env-driven provider selection (`SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`) over a caller-supplied `ProviderRegistry` of `fromEnv`-style factories, the external `selva.config.js` override (pass `configPath`), lazy memoized instantiation (nothing touches provider secrets at import/build time), flags (`SELVA_FLAG_*`, compile-time-exhaustive over `SelvaFlags`), branding with defaults, tenancy parsing, and the solve-metrics duck-type pick. Provider implementations are NOT bundled — the registry keeps this package free of dependencies on `@selvajs/local-provider` / `@selvajs/supabase-provider`.
  - **`@selvajs/selva`** — `providers.server.ts` is now the app's composition root only: the bundled-provider registry, service singletons, and Sentry/process-hook error reporting; all wiring logic delegates to the package runtime.
  - The shared `readBool`/`readPositiveInt` env parsers now warn with a `[selva]` prefix (previously `[computeLimits]`), since they serve provider flags too.

- 8860c4b: Second-wave reusable utilities extracted from the Selva app into `@selvajs/server` (tracker items E1–E6), each as a new subpath:

  - `@selvajs/server/tokens` — `createTokenCodec({ prefix, secret })`, the HMAC capability-token primitive behind share links and invites (mint 32-byte base64url tokens, HMAC-SHA256 hash at rest, constant-time hash compare, prefix recognition). The factory enforces a ≥32-character secret so a short dev secret can't reach production silently; the app's share-link and invite token modules are now thin env bindings over one codec each.
  - `@selvajs/server/errors` — `SentryErrorReporter`, the `IErrorReporter` implementation backed by a dynamically-imported `@sentry/node` (now an optional peer dependency). Literal move from the app.
  - `@selvajs/server/http` — `safeRedirectTarget` (open-redirect guard), `declaredBodySizeExceeds` (transport-agnostic Content-Length guard; the app maps it to its 413), `applySecurityHeaders` (nosniff / Referrer-Policy / Permissions-Policy / opt-in HSTS; CSP and frame headers deliberately omitted for iframe embedding — cache-control stays app policy), and `createRouteClassifier` (deny-by-default route classification: exact public pages, public prefixes, public APIs, one self-gating prefix, static assets — the app supplies its route values).
  - `@selvajs/server/access` — `createProjectAccessInputBuilder(deps)`, the marshalling layer between an app's providers and platform's pure access rules: it owns the "which rows does each project visibility need" knowledge (`platform`→grants, `private`→member, `org`/`public`→member+orgMember with the cross-org-public skip) plus the zero-I/O `projectAccessInputFromRows` for batched listing pages. Row lookups and flag reads are injected as functions.
  - `@selvajs/server/ops` — channel-aware `parseSemver`/`isNewer` (stable ignores pre-release tails; beta orders `-beta.N` and ranks a stable core above its betas) and the `ReleaseChannel` type.
  - `ComputeRateLimiter` gains `peek(key)` and `clear(key)`, making it usable for failure-counting flows; the app's hand-rolled admin login rate limiter is deleted in favor of a limiter instance from this package.

- a8e1b47: Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

  - `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.
  - `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.

## 4.7.0-beta.6

### Minor Changes

- Adding advanced caching

### Patch Changes

- Updated dependencies
  - @selvajs/compute@3.1.0-beta.15

## 4.7.0-beta.5

### Patch Changes

- a8e1b47: Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

  - `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.
  - `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.

## 4.7.0-beta.4

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

### Patch Changes

- Updated dependencies [21124cb]
  - @selvajs/compute@3.1.0-beta.13

## 4.7.0-beta.3

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

### Patch Changes

- Updated dependencies [aa2abf6]
  - @selvajs/compute@3.1.0-beta.12

## 4.7.0-beta.2

### Minor Changes

- 594b5ad: Adding advanced caching

## 4.6.21-beta.1

### Patch Changes

- 8860c4b: Second-wave reusable utilities extracted from the Selva app into `@selvajs/server` (tracker items E1–E6), each as a new subpath:

  - `@selvajs/server/tokens` — `createTokenCodec({ prefix, secret })`, the HMAC capability-token primitive behind share links and invites (mint 32-byte base64url tokens, HMAC-SHA256 hash at rest, constant-time hash compare, prefix recognition). The factory enforces a ≥32-character secret so a short dev secret can't reach production silently; the app's share-link and invite token modules are now thin env bindings over one codec each.
  - `@selvajs/server/errors` — `SentryErrorReporter`, the `IErrorReporter` implementation backed by a dynamically-imported `@sentry/node` (now an optional peer dependency). Literal move from the app.
  - `@selvajs/server/http` — `safeRedirectTarget` (open-redirect guard), `declaredBodySizeExceeds` (transport-agnostic Content-Length guard; the app maps it to its 413), `applySecurityHeaders` (nosniff / Referrer-Policy / Permissions-Policy / opt-in HSTS; CSP and frame headers deliberately omitted for iframe embedding — cache-control stays app policy), and `createRouteClassifier` (deny-by-default route classification: exact public pages, public prefixes, public APIs, one self-gating prefix, static assets — the app supplies its route values).
  - `@selvajs/server/access` — `createProjectAccessInputBuilder(deps)`, the marshalling layer between an app's providers and platform's pure access rules: it owns the "which rows does each project visibility need" knowledge (`platform`→grants, `private`→member, `org`/`public`→member+orgMember with the cross-org-public skip) plus the zero-I/O `projectAccessInputFromRows` for batched listing pages. Row lookups and flag reads are injected as functions.
  - `@selvajs/server/ops` — channel-aware `parseSemver`/`isNewer` (stable ignores pre-release tails; beta orders `-beta.N` and ranks a stable core above its betas) and the `ReleaseChannel` type.
  - `ComputeRateLimiter` gains `peek(key)` and `clear(key)`, making it usable for failure-counting flows; the app's hand-rolled admin login rate limiter is deleted in favor of a limiter instance from this package.

## 4.6.21-beta.0

### Patch Changes

- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- 2673995: Extract the configurable provider wiring into `@selvajs/server/providers` (embeddable-server-layer K5):

  - **`createSelvaProviders(env, options)`** — the reusable core of the app's composition root: env-driven provider selection (`SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`) over a caller-supplied `ProviderRegistry` of `fromEnv`-style factories, the external `selva.config.js` override (pass `configPath`), lazy memoized instantiation (nothing touches provider secrets at import/build time), flags (`SELVA_FLAG_*`, compile-time-exhaustive over `SelvaFlags`), branding with defaults, tenancy parsing, and the solve-metrics duck-type pick. Provider implementations are NOT bundled — the registry keeps this package free of dependencies on `@selvajs/local-provider` / `@selvajs/supabase-provider`.
  - **`@selvajs/selva`** — `providers.server.ts` is now the app's composition root only: the bundled-provider registry, service singletons, and Sentry/process-hook error reporting; all wiring logic delegates to the package runtime.
  - The shared `readBool`/`readPositiveInt` env parsers now warn with a `[selva]` prefix (previously `[computeLimits]`), since they serve provider flags too.

## 4.6.20

### Patch Changes

- d3f57e2: Two data-hygiene fixes for user lists. Header-auth now mirrors email and display name from the proxy headers on every visit instead of writing them once — an IdP rename, or a corrected proxy config that used to forward the wrong claim (e.g. the OIDC `sub` as the display name), heals the stored allowlist row on the user's next login. Deleting a user now also soft-deletes their org memberships in the local data provider (Supabase already gets this via FK cascade), so the team roster no longer accumulates orphaned rows that render as bare user IDs.

## 4.6.19

### Patch Changes

- 19754b9: Show real names instead of raw user IDs for header-auth users in the admin and team user lists. Allowlisted users who have not signed in yet have no materialized email, so every list fell back to their UUID; the auth provider now exposes the allowlisted UPN (the address the admin typed) as the email until the real one arrives from the proxy headers on first login, and both lists now surface the IdP display name (`SELVA-DisplayName`) when the user has not set a profile name. Also fixes the admin users page doing a `getOrgMember` round-trip per user on every load — memberships are now fetched as one listing (drained across pages, so orgs beyond 200 members no longer render users as permissionless, which the permission-toggle UI could have turned into an accidental permission wipe).

## 4.6.18

### Patch Changes

- 6d4a66d: Surface session expiry as a clear, actionable error instead of a silent failure. Sessions are capped at 8 hours, so a compute page left open outlives its `admin_session` cookie — the next solve POST then went out unauthenticated and failed with an empty response and a bare "Compute error" (or a raw `SyntaxError` when a proxy replaced the body). The API 401 from the auth hook now says "Your session has expired. Sign in again to continue.", which every fetch call site that displays the response message picks up. The compute solve path additionally detects expiry without relying on the response body (an SSO proxy such as Azure App Proxy can strip it): a 401 or a redirect to `/login` tells the user to sign in again in a new tab and re-run — preserving their input state on the page — the generic fallback now names the HTTP status, and a non-JSON body on a 200 reports an invalid server response instead of the parse exception.

## 4.6.17

### Patch Changes

- 6edd345: Dynamic value list selections now actually reach Rhino.Compute. The solve route's input transform delegates to `processInput`, which has no `dynamicValueList` handler — the input fell to the Geometry fallback with a null default and `TreeBuilder.fromInputParams` silently dropped it, so the definition always solved on the param's own server-side fallback (wired seed option or empty string) regardless of what the user picked. Empty fallbacks cascaded as null geometry into downstream components ("Object reference not set" on e.g. Bounding Rectangle) and nulled every output beyond them. `dynamicValueList` now maps to the ValueList wire contract, matching the plugin's `GetDynamicValueListParameter` (`TypeName = "ValueList"`), so the selection rides the solve request like any static value list. Also restores array defaults (multi-select/checklist values) that `processInput` drops as malformed, which would have omitted those inputs the same way.

## 4.6.16

### Patch Changes

- 35817e4: Add a network throughput test to /admin/system (instance admins). Upload and download tests transfer incompressible random data between the browser and the server through the full transport path (reverse proxy, SSO tunnels such as Azure App Proxy), measuring real transfer speed per direction — the ceiling any large solve payload is subject to. Backed by a new `/admin/api/system/throughput` endpoint (streamed download up to 64 MB, stream-counted upload up to 128 MB, memory-flat). Complements the env-flag-gated `/api/diag/throughput` curl probe with a UI that works behind SSO proxies where curl cannot authenticate. Also adds a response-whales log line naming the outputs that dominate large solve results.

## 4.6.15

### Patch Changes

- 0815369: Diagnostic logging for the dynamic value list memory investigation: large options-payload parses log size, option count and duration (should fire once per distinct solve result — a storm means memoization is defeated); every system auto-pick on a value list logs itself so a reconciliation loop is visible as a numbered sequence; and the browser solve line includes a JS heap watermark (Chrome) so a retention leak shows as a monotonic climb across a session.

## 4.6.14

### Patch Changes

- 739b1cd: Move the solve-request values projection into the solve session itself. The session merges solve outputs into the same values map that inputs live in (so widgets like dynamic value lists can read them), and previously dispatched the whole map to the transport — the Selva app filtered it back down in its own onSolve, but any other app built on `@selvajs/ui` would unknowingly re-upload multi-MB output payloads (a measured 6.4 MB options list) on every solve. `dispatch()` now projects values down to schema-input ids before calling the driver, so every transport — HTTP, WebSocket, or custom — gets input-only values by contract, and the app-level filter is removed as redundant.

## 4.6.13

### Patch Changes

- c7f2cbe: Republish to pick up `@selvajs/ui` 4.12.1: dynamic value list inputs now fall back to the first available option when no selection was ever made, preventing empty-selection solves from cascading null-data errors through definitions and caching geometry-less results.

## 4.6.12

### Patch Changes

- 1911353: Measure response gzip as its own timing phase. Compression now runs before the Server-Timing snapshot and is reported as `gzip` (header + browser log + server debug log), so its cost no longer silently inflates the browser's network-latency estimate.
- 1911353: Add a result-health line to the browser solve log: how many schema outputs came back populated, which are empty (by nickname), and the solve's Grasshopper error/warning counts with the first error inline. An abnormally fast solve that returns no geometry — e.g. a stale dynamic value list selection killing the heavy branch — is now diagnosable from the console instead of appearing as an unexplained empty viewer.

## 4.6.11

### Patch Changes

- 61d6055: Stop re-uploading solve outputs in the solve request. The solve session merges result outputs (e.g. dynamic value list option payloads, which can be several MB) back into the same values map that inputs live in; the library runner previously snapshotted that whole map into the POST body on every solve. The server only ever reads input-keyed values, so the output entries were dead weight — a measured 6.4 MB per solve on a definition with a large computed value list. The runner now sends only values keyed by schema input ids, shrinking such requests from megabytes back to kilobytes.

## 4.6.10

### Patch Changes

- a7d3728: Fix truncated `/api/compute` responses surfacing as `Unterminated string in JSON` in the browser. Solve responses are now gzipped in one buffered pass and sent with an explicit `Content-Length` (instead of a streamed `CompressionStream` body with no length), so a connection cut mid-transfer — e.g. a proxy/tunnel timeout on a multi-minute large download — fails as a hard network error the client can detect and retry, rather than resolving with a partial body that `JSON.parse` rejects. Buffered compression costs only a few hundred ms on a ~40 MB payload, negligible next to the transfer time it protects.
- a7d3728: Request-whale log entries now show the input's nickname and param type instead of its GUID. Also replace a literal NUL byte in the compute client cache-key separator with the `�` escape — same key semantics, but the file is no longer treated as binary by git/grep.

## 4.6.9

### Patch Changes

- 607d1bc: Name the inputs responsible for heavy solve requests: when the `values` payload exceeds 256 KB, the browser log lists the three largest inputs by name and size, so an embedded geometry/file value paying the slow uplink on every solve is identified directly. Also replace the opaque "Failed to fetch" on solve requests killed by an SSO proxy session expiry (302-to-IdP blocked by CORS) with an actionable "reload the page to sign in again" error.

## 4.6.8

### Patch Changes

- cf5e5c5: Log the solve request payload size (total and the `values` share) in the browser compute timing line. A large request body — e.g. a geometry or file input embedded in `values` — pays the same slow uplink as the result download and previously surfaced only as an unexplained slow `body` prep mark on the server.

## 4.6.7

### Patch Changes

- 852a9df: Break the solve route's pre-solve "load" phase into named sub-steps (body parse, share-token resolve, definition/project/version DB reads, access check, blob fetch, compute-server resolve, schema backfill, client init). Each step's duration is exposed as a `p_*` entry on the `Server-Timing` header and printed as a `prep:` line in the browser solve log, so an intermittent multi-second load spike names the exact step responsible instead of one opaque number. Cache verdicts (Selva response-cache hit, definition re-upload) are also surfaced on `Server-Timing` and printed browser-side, so the full solve diagnosis works without server log access.

## 4.6.6

### Patch Changes

- cda6b34: Gzip `/api/compute` solve responses when the client accepts it. Solve results are large geometry JSON and were previously sent uncompressed; the response is now streamed through gzip (with `Vary: Accept-Encoding`, skipped for clients without gzip support), typically shrinking the payload several-fold — a near-proportional download speedup on byte-throttled links such as reverse-proxy tunnels. With `SELVA_FLAG_COMPUTE_DEBUG` the server logs the compression ratio per solve, and warns when a fronting proxy strips `Accept-Encoding` (making end-to-end compression impossible). Also includes the debug-gated `/api/diag/throughput` endpoint for isolating slow transport segments.

## 4.6.5

### Patch Changes

- 0f976c9: Add a debug-gated `/api/diag/throughput` endpoint (requires `SELVA_FLAG_COMPUTE_DEBUG` + a logged-in user) that streams incompressible random bytes through the same transport stack as solve responses. Measuring its MB/s from different vantage points (localhost against Node directly, through the reverse proxy, from the client) isolates which segment makes large solve downloads slow — app, proxy, or network.

## 4.6.4

### Patch Changes

- 6d8a97d: Extend compute timing logs to cover every network leg. The `Server-Timing` header now includes the compute server's own decode/solve/encode plus a derived `compute_link` segment — the traffic + queue time between the Selva server and Rhino.Compute, previously hidden inside the solve wall time. The browser log adds two cross-check lines: the compute-server split, and a network-stack view from the Resource Timing API showing actual bytes on the wire and whether the response was compressed in transit — confirming whether a long download is genuine transfer time.

## 4.6.3

### Patch Changes

- 7163966: Add full per-phase compute timing to pinpoint where solve latency goes. The per-solve `[Compute/browser]` log now breaks the round-trip into: network (request-send + latency), server (via a new `Server-Timing` response header — load / tree / solve / serialize sub-phases), download (payload transmission with size and effective MB/s), JSON decode, rhino3dm init, mesh extraction, and output mapping. This lets a "16s solve with cached compute" be attributed precisely — e.g. large-payload download vs. server serialization vs. mesh decode — instead of being a single opaque number. The server route also sets `Server-Timing` on every `/api/compute` response so the frontend can separate server work from network transfer without enabling server-side debug logging.

## 4.6.2

### Patch Changes

- 65176f7: Add per-segment compute timing logs. The browser now logs a concise round-trip + parse breakdown per solve (always on), and `SELVA_FLAG_COMPUTE_DEBUG` now also emits a `[Compute/server]` line timing the server-side phases the solve metric excludes (definition load, input tree build, response serialization). Together with the existing Rhino.Compute and cache logs, these let you decompose end-to-end solve latency across browser, Selva server, and compute server.

## 4.6.1

### Patch Changes

- 639c796: Patch release

## 4.6.0

### Minor Changes

- 2173bef: Organization assets & branding. Admins can now upload and manage per-org assets (including a logo) from the admin area, backed by a new asset-upload flow and org asset service. Served files are classified and gated by visibility/access-control checks on the `/api/files` route, and the owning org's logo is forwarded to the viewer as a branding watermark.
- 2173bef: Run or preview any historical definition version. The versioning tab's "Run" action can now open the runner against an arbitrary version — not just the live/draft channel pointer — via a `?version=` param, and the compute route accepts a matching `versionId`. Explicit-version runs are editor-only and never accessible through share tokens, and the runner shows a "vN preview" badge.

### Patch Changes

- 2173bef: Fix Supabase local port configuration and wire the solve-metric sink into the server test setup.

## 4.6.0-beta.2

### Patch Changes

- New beta release

## 4.6.0-beta.1

### Patch Changes

- 7a41015: New beta release

## 4.6.0-beta.0

### Minor Changes

- c7fd212: Add an admin-selectable **release channel** so instances can opt into beta builds and revert to stable.
  - **Admin → System → Release channel**: instance admins (`manage_updates`) choose **Stable** (npm `latest`) or **Beta** (npm `beta` dist-tag). The choice persists to `selva-channel.json` in the deployment dir so both the app and the update runner read it; absent/invalid ⇒ Stable (the historic default).
  - **Switch-only**: changing the channel doesn't update anything — the operator then runs **Application Update**, which installs `@selvajs/{cli,selva}` pinned to the chosen channel's dist-tag.
  - **Beta → Stable revert** works the same way and correctly downgrades: the update runner now `npm install`s the channel-tagged version instead of `npm update` (which can only move forward), so reverting from a beta lands on the older stable release. The existing health-probe + rollback still guards a bad install.
  - The update-availability check and badge on **Admin → System** now reflect the selected channel (beta-aware semver ordering surfaces `beta.1 → beta.2` and beta→stable promotions; stable-channel behavior is unchanged).

- 8a238c4: Surface more compute server info and make upload/solve limits visible and legible.
  - **Admin → Compute**: each reachable server now shows live **active children** (read passively — never spawns children, so an idle pool reads as 0) and **idle time** (seconds since the last child request), alongside the existing version/plugin tiles.
  - **Admin → System**: new read-only panel listing the resolved compute/upload limits (max solve duration, rate limits, file-size caps, request/response byte caps, remote-definition fetch limits, cache TTL) so operators can see what's enforced without reading `.env`.
  - **Definition upload**: oversized `.gh` uploads now fail with a clear "file too large" message. A new pre-read body-size guard returns the app's JSON error envelope instead of letting an opaque non-JSON 413 from adapter-node/proxy surface as a misleading "Compute server error".
  - **Fix**: server-side env-driven config (`MAX_SOLVE_DURATION_MS`, rate-limit, file-size caps, `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, `ALLOW_INSECURE_COOKIES`) now reads via SvelteKit's `$env/dynamic/private` instead of bare `process.env`. Under `vite dev`, Vite never mirrors `.env` into `process.env`, so every `.env` override was silently ignored in development and the hard-coded defaults were used regardless. An ESLint rule (`no-restricted-properties`) now warns on bare `process.env` in selva server code to prevent regressions; legit OS-level reads (`NODE_ENV`/`PATH`/`HOME`) opt out with a documented inline disable.
  - **Admin → System**: the "Compute rate limit" row now lists both env keys that drive it (`COMPUTE_RATE_LIMIT_MAX` and `COMPUTE_RATE_LIMIT_WINDOW_MS`) — previously the window var was invisible, so operators couldn't tell how to change the "/ 1.7 min" window.

## 4.5.1

### Patch Changes

- 33ac5e0: Fix `redirect()` (and other SvelteKit control-flow throws) surfacing as an "[Unhandled error]" 500 instead of redirecting. The monorepo resolved `@sveltejs/kit` against two Vite majors, splitting it into multiple module instances and breaking SvelteKit's `instanceof Redirect`/`HttpError` checks. The shared Vite config now dedupes `@sveltejs/kit`, `svelte`, and `vite` to a single physical copy.

## 4.5.0

### Minor Changes

- fed3a9e: Capture per-solve timing and outcome telemetry.
  - **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
  - **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
  - **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.

## 4.4.0

### Minor Changes

- 8039673: Harden and extend the compute server. SSRF protection on compute requests is
  substantially stronger: URL validation now rejects a wider range of internal,
  loopback, and metadata-endpoint targets before any outbound fetch. Compute
  request/response limits were updated, the `/api/compute` route was simplified,
  and file-import now accepts URLs with improved error handling. The
  WebSocket solve driver gained richer logging and dynamic asset loading, and
  display handling supports non-mesh display items and preview geometry.

## 4.3.5

### Patch Changes

- a52aed3: Fix premature "back online" verdict after an admin update. The update poller declared the app online as soon as `/api/health` reported a fresh `instanceId`, but that lightweight endpoint answers a beat before the app can serve real routes through the proxy — so an immediate health-check click could race a 502. The poller now additionally requires the heavier `/admin/api/system/health` route to answer 200 before reporting "back online" (gated on HTTP reachability, not its verdict, so a degraded-but-up instance still counts as online).

## 4.3.4

### Patch Changes

- a315803: Admin dashboard: show the installed `@selvajs/selva` version instead of the Selva repo's git commit.

  The General admin page had a "Web app build" card populated from build-time `__GIT_*__` constants — i.e. the last commit of the Selva monorepo when the package was published, not anything the operator controls. On an npm deployment that showed confusing values like "Merge pull request #82…". Replaced it with an "Installed version" card sourced from the deployment's own `@selvajs/selva` package version, and removed the now-dead git-info plumbing (vite `define`, `app.d.ts` globals, eslint globals).

## 4.3.3

### Patch Changes

- e9579b9: Admin updater: npm-only, with an "update available" indicator.
  - The admin update runner no longer reports "online" before the new process is actually serving. `/api/health` now returns a per-boot `instanceId`; the post-restart poller waits for it to change, which reliably distinguishes a fresh process (the old git-commit fingerprint was always null under npm, so the poller fell back to a race that latched onto the dying old process — a reload then hit a 503).
  - Removed the git/`scripts/update.sh` self-update path from the admin endpoint. Deployments update via npm (`npm update @selvajs/*`) exclusively; the dead `commit` field is gone from `/api/health`.
  - The System page now checks the npm registry on load and shows an "update available — vX → vY" badge when a newer `@selvajs/selva` is published. Degrades silently if the registry is unreachable.

## 4.3.2

### Patch Changes

- 448e52e: Fix: the admin update runner no longer reports "online" before the new process is actually serving.

  The post-restart poller keyed on a git commit hash from `/api/health` to detect the new process. In npm-mode deployments there's no git repo, so the hash was `null` on both old and new processes — the check fell back to "two successful health checks = online", which the still-running old process satisfied moments before PM2 killed it. Result: the UI declared success (without a version transition), but a reload hit a 503 until the new process finished booting. `/api/health` now returns a per-boot `instanceId` (and the installed `version`); the poller waits for the `instanceId` to change, which works in every deployment shape and correctly distinguishes a fresh process — including same-version rollbacks/reinstalls.

## 4.3.1

### Patch Changes

- 88660fa: Fix: extract a definition's schema on the compute server the upload selects, not the org/global default.

  `POST /api/compute/schema` resolved a server without a definition pin, so the pre-upload schema preview always ran on the org default → global default. If the upload dialog selected a non-default server, the schema was extracted on a different server than the one that later solves the definition — masking server-specific differences (e.g. block-instance support in the VektorNode Compute fork). The endpoint now accepts a `computeServerId` query param and threads it as the resolution pin, mirroring `POST /api/definitions`. The Add Definition dialog sends the selected server and re-validates when that selection changes.

## 4.3.0

### Minor Changes

- 7db97cb: Raise the `/api/compute` request body cap to fit `file` widget uploads. A file input embeds its geometry as base64 inside `values`, inflating the raw bytes by ~4/3, so a worst-case body for the 150 MB client file cap is ~200 MB. `COMPUTE_REQUEST_MAX_BYTES` now defaults to 210 MB (was 5 MB), and the `BODY_SIZE_LIMIT` guidance in `.env.example` is updated to `210M` to stay above it. Both remain overridable via env.

## 4.2.1

### Patch Changes

- 4b2fa03: Fix production build crashing when runtime secrets are absent.

  Provider wiring in `providers.server.ts` previously instantiated auth/data/storage
  providers at module-import time, which calls `*.fromEnv()` and validates required
  secrets (e.g. `SELVA_HMAC_KEY`). Because `vite build` loads the SSR bundle, this made
  **building** the app require a full runtime environment — CI builds without those vars
  crashed with `Missing required env var: SELVA_HMAC_KEY`.

  Provider instantiation is now lazy and memoized via `resolveProviders()`: it runs on the
  first request rather than at import. Importing the module is side-effect free, so builds
  no longer need deployment secrets. Internal value exports (`tenancy`, `branding`,
  `flags`, `definitionService`) became accessor functions (`getTenancy()`, `getBranding()`,
  `flag()`, `getDefinitionService()`); the `providers` export is kept as a lazy proxy for
  backward compatibility.

## 4.0.0

### Minor Changes

- 9ded581: Cache each definition version's compute-extracted UI schema on the version row, and make schema extraction a hard upload gate.

  `DefinitionVersion` gains optional `schema` + `schemaExtractedAt`, and `IDefinitionStore` gains `setVersionSchema`. On upload, the schema is now extracted and validated against Rhino.Compute **before** any blob or version row is written — a compute outage or a definition with no valid `Schema` output rejects the upload (503 / 422) with nothing persisted. The render path reads the cached schema instead of re-fetching it from compute on every load, falling back to a live fetch (plus a temporary solve-time backfill) for versions uploaded before this change.

  `@selvajs/platform` now re-exports the `UISchema` type from `@selvajs/schemas` (types-only dependency). The Supabase provider adds a `0002` migration creating `definition_versions.schema` / `schema_extracted_at` (and the previously-missing `change_note`) columns.

## 3.0.0

### Patch Changes

- 3e5ebe3: Prep the render path for server-resolved `bound` inputs.

  Extracted the `library/[guid]` render path into a reusable `loadDefinitionForRender` helper so the bound-input solve path has a single home. The boot-time integrity check now fires on the first request instead of at module load, so test files importing the route-classification helpers no longer trip provider lookups before their fakes are wired.

- 3e5ebe3: Remove the temporary forward-auth debug instrumentation from the login flow now that header-auth deployments have stabilized.

  Removed the `/login` miss header dump in the SvelteKit hook layer and the original debug `Debug: request headers` block. The login page now distinguishes "proxy forwarded no identity headers" from "headers arrived but the user isn't allowlisted", and shows a redacted request-header snapshot in both forward-auth failure cases as a stabilization aid.

## 2.0.11

### Patch Changes

- ac63500: Add temporary debug logging of incoming request headers to diagnose forward-auth header forwarding on fresh deployments.
  - `@selvajs/header-auth-provider`: `identifyFromHeaders` now logs every header received whenever identification fails (no UPN, disabled entry, or UPN not in the allowlist). Logs are tagged `[HeaderAuth][debug]` for easy grepping and run per-request, not once per process, so operators can compare attempts back-to-back. Exports two helpers — `dumpHeaders(headers)` and `snapshotHeaders(headers)` — so callers can reuse the same format.
  - `@selvajs/selva`: the SvelteKit hook layer dumps full request headers on every `/login` miss under proxy-auth, and `/login` itself now renders a collapsible `Debug: request headers` block listing every header name and value when `hasProxyAuth` is true. This lets operators verify forward-auth wiring without server log access.
  - `@selvajs/platform`: `IProxyAuth.hasNoIdentityHeaders` and `IProxyAuth.configuredHeaderNames` are no longer optional. The only implementer (`HeaderAuthProvider`) already supplied both, and making them required removes the `?.` fallbacks at the hook layer.

  These are intentionally noisy and intended to be removed once header-auth deployments stabilize. Search the codebase for `[HeaderAuth][debug]` and `DEBUG (temporary, remove after deployment stabilizes)` to find every site.

## 2.0.10

### Patch Changes

- 48c6886: Improve forward-auth diagnostics on the login page.
  - If a user is already authenticated (cookie session OR forward-auth headers) when they land on `/login`, they're now redirected to `?redirectTo=` or `/library` instead of seeing the confusing "your proxy didn't forward the identity headers" fallback message that was rendered even when forward-auth was working correctly.
  - The header-auth provider now emits a one-shot `[HeaderAuth]` warning on the first request that arrives with none of the configured `SELVA-*` identity headers, naming the expected headers and pointing operators at the README. A second one-shot warning fires when `/login` is hit and proxy identification fails, distinguishing "no headers arrived at all" (proxy bypassed or misconfigured) from "headers arrived but UPN missing or user not allowlisted". Throttled per-process so anonymous traffic doesn't spam the logs.

- 74252bd: Skip the header-auth bootstrap-wiring (and its stale-provider warning) when the configured auth provider doesn't expose `proxyAuth`. Previously, deployments using `LocalAuthProvider` or `SupabaseAuthProvider` that also set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` would see a misleading `[selva] BOOTSTRAP_INSTANCE_ADMIN_EMAIL is set but the installed @selvajs/header-auth-provider does not expose setBootstrapAllowlistPolicy…` warning on boot, even though the env var is correctly consumed by the OAuth/password bootstrap path. The warning is now only emitted when the active provider is actually a proxy-style auth provider that's out of date.

## 2.0.9

### Patch Changes

- **Gate Platform projects behind `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`.** The admin → Projects surface — instance-admin-owned projects granted to orgs or individual users — is now opt-in like the other platform flags, off by default. When off, the nav entry is hidden, the routes 404, the admin API rejects, platform-visibility projects are filtered out of every list, and the access rules treat them as inaccessible (instance_admin included). Existing rows are preserved; flipping the flag back on restores access.
  - `selva create` lists the new flag in the platform-flags multiselect, alongside `ALLOW_ORG_CREATION`, `ENABLE_SHARING`, etc.
  - `.env.example` documents the flag in the `PLATFORM FEATURE FLAGS` block.
  - Rule layer: `ProjectAccessInput` and `DefinitionAccessInput` carry a new `enablePlatformProjects` boolean. Off short-circuits every `canView` / `canSolve` / `canEdit` / `canManage` / `canEditProjectSettings` / `canEditDefinition` call against a platform-visibility project to `false` — single source of truth, so route and listing code can't drift.

  Existing deployments that want the feature: set `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS=true` in `.env` and restart.

## 2.0.8

### Patch Changes

- **Fix admin "Run Update" leaving the app offline.** The bash script driving the npm-mode update was being killed by PM2's tree-kill when it called `pm2 stop selva-compute` — Node's `{ detached: true }` only creates a new session/process group but does not change the parent-child relationship that tree-kill walks. Result: bash died right after stopping the app, `npm update` and `pm2 start` never ran, and the site stayed down until someone SSH'd in.

  The runner is now daemonized via `setsid bash … &` + `disown` + immediate launcher exit, so its PPID becomes 1 (init) before it does anything destructive. Tree-kill can no longer reach it.

  Additional hardening to the same code path:
  - **Pre-flight version check.** `npm view @selvajs/selva version` runs before any stop/install/start cycle. If the deployment is already on the latest version, the script exits clean without taking the app down.
  - **EXIT-trap safety net.** On any exit path (clean, crash, kill, npm hang) the runner checks `pm2 jlist` and, if selva-compute isn't reporting `online`, unconditionally starts it from `ecosystem.config.cjs`. The app should never stay dark after the runner exits.
  - **Start from ecosystem.config.cjs**, not `pm2 start selva-compute` by name — the latter fails when `pm2 update` has wiped the in-memory process list.
  - **PORT is read from `.env`** for the health probe, matching `scripts/update.sh` behavior.
  - **Frontend poll window** extended from 90s to 5min — npm update + pm2 cold start on slow VPS instances legitimately exceeds 90s.

## 2.0.7

### Patch Changes

- Fix admin Update aborting mid-flight right after `pm2 stop`, leaving selva-compute permanently stopped.

  The tee'd-log wrapper introduced in 2.0.5 didn't survive the SIGPIPE cascade that fires when `pm2 stop selva-compute` succeeds. Cascade was: pm2 kills selva-compute → the pipe between `tee` and the parent process breaks → `tee` gets SIGPIPE on its next stdout write and dies → bash's next write goes to the now-dead tee subprocess → bash gets SIGPIPE and exits. Net result: the script wrote `pm2 stop` output to the log file, then nothing — never reached `npm update` or `pm2 start`, leaving the deployment with selva-compute stopped and no clue from the UI (SSE was dead, log file truncated at the stop step).

  Fix: `tee --output-error=warn-nopipe` keeps tee alive when its stdout pipe breaks (file writes continue), `trap '' PIPE` makes bash ignore SIGPIPE, and `2>/dev/null` silences tee's now-irrelevant warning. The script now runs to completion regardless of whether the SSE consumer is still alive — which is exactly the property the log-file mechanism needs to be useful.

  Operators on 2.0.6 whose admin Update click left selva-compute stopped can recover with `./node_modules/.bin/pm2 start selva-compute --update-env`.

## 2.0.6

### Patch Changes

- Fix `pm2: command not found` in the admin Update endpoint when no global pm2 is installed.

  The endpoint spawned the update bash script with `PATH: process.env.PATH`, which on most servers doesn't include the deployment's `node_modules/.bin`. As soon as a host removed its global pm2 (recommended after 2.0.5 to prevent daemon/CLI version skew), every admin Update click failed at `pm2 stop` with "command not found" — silently leaving the running process untouched and exiting `[FATAL]` at `pm2 start`.

  Fix: prepend `${plan.cwd}/node_modules/.bin` to the spawned script's PATH so it resolves to the project-local pm2, mirroring the local-only resolution in `@selvajs/cli`'s `pm2Bin()`. The deployment now uses one consistent pm2 from every entry point — interactive shell, `selva start`, and the admin endpoint.

## 2.0.5

### Patch Changes

- Fix admin Update hangs caused by PM2 daemon/CLI version skew, and recover lost log output during the post-restart blackout.

  **PM2 daemon/CLI sync.** The CLI scaffold previously installed `pm2: '^5.4.0'` (caret) and `pm2Bin()` fell back to a global pm2 if the local one was missing. Both choices made it possible for two pm2 binaries to manage the same daemon, producing `In-memory PM2 is out-of-date` warnings and stops/restarts that hung mid-flight. The fix:
  - Pin `pm2` to an exact version in scaffolded deployments (`5.4.3`).
  - `pm2Bin()` is now local-only — errors loudly if `node_modules/.bin/pm2` is missing instead of silently using a possibly-different global pm2.
  - New `ensurePm2InSync()` helper runs before every state-changing pm2 call (`selva start`/`stop`/`restart`/`update`); detects daemon/CLI skew and runs `pm2 update` to respawn the daemon under the local CLI before continuing.
  - Same skew detection added to the bash side of the admin update endpoint and `scripts/update.sh`, so the check runs even when the JS wrapper isn't on the call path.

  **Update log visibility.** The admin Update endpoint streams script output via SSE, but the SSE is served by `selva-compute` itself — so the moment `pm2 stop selva-compute` succeeds, the stream dies and the frontend goes blind. Anything that happened afterwards (npm update output, pm2 start result, health probe, rollback) was invisible, leaving operators with an infinite spinner and no diagnostics. The fix:
  - Bash wrapper tees all script stdout/stderr to `/tmp/selva-update.log`. The detached process keeps writing to the file even after SSE dies.
  - `GET /admin/api/system/update` returns the log file contents (admin-only).
  - During the post-restart wait, the frontend polls the log endpoint alongside `/api/health` and replaces the displayed logs with the full file content as soon as the new process is reachable — surfacing the entire blackout chunk in one shot.

  Operators on existing hosts that have a global pm2 installed alongside the project-local one should run `npm uninstall -g pm2` after upgrading, then `./node_modules/.bin/pm2 update` once to align the daemon. New scaffolds are unaffected.

## 2.0.4

### Patch Changes

- **Fix: header-auth and OAuth deployments now seed a default org on first admin login.** Previously only the `/setup` password flow created the single-tenant default Organization + Project, so deployments using header-auth or OAuth callback landed without an org. Without an org, `actingOrgId` resolved to `undefined` and any org-scoped permissions (`manage_projects`, `manage_definitions`) assigned in the admin UI were silently dropped instead of persisted.

  The seed now runs inside `bootstrapUserSession`, self-heals existing deployments that are missing their org, and no-ops once an org exists.

## 2.0.3

## 2.0.2

### Patch Changes

- f49433c: **Env-driven provider wiring.** New deployments no longer ship a `selva.config.js` — provider selection moved into the runtime, driven by `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env`. Provider implementations remain bundled into `@selvajs/selva`; the only operator-facing files are `.env` and `ecosystem.config.cjs`.
  - `selva create` writes `.env` + `ecosystem.config.cjs` + `package.json`. The deployment `package.json` now lists only `@selvajs/cli`, `@selvajs/selva`, and `pm2`.
  - `selva migrate` detects existing deployments and (a) drops the now-bundled provider packages from `package.json`, (b) backs up and deletes any stale `selva.config.js`, and (c) rewrites `ecosystem.config.cjs` if it still points at `@selvajs/runtime`.
  - `selva doctor` checks for layout drift across all three of the above.
  - The escape hatch for custom providers is still `SELVA_CONFIG_PATH`: set it to a `.js` file exporting a `defineConfig()` result.

  Existing deployments: run `selva migrate` after updating. The CLI prints the full set of changes before applying them and saves `.bak` files for every file it touches.

## 2.0.1

## 2.0.0

### Minor Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

## 0.10.0

### Minor Changes

- # 0.10.0

  A broad release covering platform foundations, a new drawing/PDF pipeline, unified drag-and-drop, schema-source-of-truth work, and a new forward-auth provider. Web apps and `@selvajs/ui` are aligned at 0.10.0; library packages move to the next minor in their respective tracks. The Grasshopper plugin ships as 0.10.0 (beta tag dropped).

  ## Apps & UI (`@selvajs/plugin-ui`, `@selvajs/selva`, `@selvajs/ui`)

  ### Plugin-UI
  - Unified drag-and-drop on `svelte-dnd-action` with a thin cross-type coordinator (replaces three coexisting systems).
  - Schema source-of-truth refactor: canonical/draft split, content-hash for safe save, removal of version/edit-intent state, eliminates drift between plugin `_embeddedSchema`, UI state, and localStorage.
  - New components: `ImageUploadField`, `DataTable`, mode toggle, resizable, scroll-area, search, select, separator, slider, sonner, switch, tabs, textarea, theme switcher.
  - `NumberWidgetConfig` gains `hideRange` for UI control.
  - External input handling with a UI toggle for input sources.
  - Resizable-handle styling, grid-item visibility + column positioning, dropzone active-state highlights.
  - Compute throttle + solving indicator; util reorganisation.

  ### Selva
  - Project-owner definition uploads with access-control tests.
  - Project visibility handling tightened in access-control logic.
  - StatCard refactor across project/team pages and updated project navigation.
  - Audit-log functionality with query support and UI integration.
  - API endpoints for managing platform projects and grants; reclaim functionality.
  - Email-link authentication.
  - Compute-server management refactored to support platform and org-private servers; permissions docs clarified for role scopes.

  ### Cross-cutting UI
  - WebSocket connection handling and schema-history management hardened.
  - Schema history + validation improvements.
  - `NotificationManager` interface + implementation for message handling.
  - Primitive imports and layout-structure refactor; component conventions normalised (see plugin-ui `lib/README`).

  ## Drawing system (`Selva.Drawing` + UI)
  - New SVG drawing components, dimensioning, curve creation, and export.
  - `GH_Page`, `GH_PathStyle` improvements; `RhinoViewportVisitor` rendering enhancements.
  - `DrawingView` / `GH_DrawingView` support multiple geometry elements with auto-fit.
  - New table/grid header-style + fill options.
  - Document layout + pagination logic refactor; `GridOverflow` class + `ComputeOverflows` method for multi-page output.
  - New icons and a page-flow plan for multi-page output.

  ## Schemas (`@selvajs/schemas`)
  - Modular Zod-based validation system for `UISchema`.
  - Custom `IGH_Goo` types for `ValueList`, `ThreeMaterial`, `FileData`, `UISchema` with serialization.
  - `SchemaArchiveSerializer` for schema + values archive serialization.

  ## Platform & providers
  - `@selvajs/header-auth-provider` (new): forward-auth via trusted upstream proxy. Identity verification from proxy headers, allowlist management for user entries.
  - `@selvajs/platform`: project-grant store + interfaces; reclaim flow; clearer role scopes.
  - `@selvajs/local-provider`: env-var handling refactor.

  ## Plugin (.NET / Grasshopper)
  - WebSocket message handling and validation overhauled.
  - Document synchronization and schema handling refactor.
  - Robust volatile + persistent parameter-value extraction.
  - Multi-target: net48 + net7.0 (Rhino 8), net9.0 (Rhino 9-wip) with separate `manifest-rh8.yml` / `manifest-rh9.yml`. Rhino 7 is not supported.
  - Grasshopper group import + enhanced grouping options.
  - `BinaryGeometryWriter` for optimized mesh delivery.
  - `ValueApplicator` + `ValueCollector` services replace ad-hoc plumbing in UIBuilder.
  - Install-directory resolution improvements in the update script.

  ## Tooling, infra, docs
  - Turborepo integration: `pnpm build` / `check` / `type-check` / `test` / `generate` orchestrated via turbo with caching (see `docs/Turborepo.md`).
  - New data-directory layout + setup script changes.
  - PM2 deployment: `--env-file` flag via `node_args` (replaces silently-ignored `env_file` on `pm2 start`).
  - `@selvajs/schemas` workspace dependencies normalised to `workspace:*`.
  - Grasshopper example definitions unignored.
  - Added CONTRIBUTING + changelog; TypeScript schema generation pipeline.

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.10.0
  - @selvajs/schemas@1.2.0
  - @selvajs/platform@0.2.0

## 0.9.0

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.9.0

## 0.8.4

### Patch Changes

- Refactor: extract solve/state logic into self-contained `ComputeApp` component
  - Add `ComputeApp.svelte` to `@selvajs/ui` — wraps all solve logic, throttling, solving indicator, definition switching, embed mode, custom primary color, and footer registration into one component
  - Add `showSaveButton`, `showLoadButton`, `stateManagerActions` props to `ComputeApp` and `AppLayout` for flexible state manager configuration
  - Add optional `header` and `children` snippets to `ComputeApp` for custom nav/layout
  - Extract `ActionButton` type to `shared/types/actionButton.ts` and `SolveFn`/`SolveResult` to `shared/types/solveFn.ts`
  - Move `hexToOklch` color utility from compute-app to `@selvajs/ui`
  - Slim `compute-app/+page.svelte` from ~280 lines to ~58 lines

- Updated dependencies
  - @selvajs/ui@0.8.4

## 0.8.3

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.8.3
