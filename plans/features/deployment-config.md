# Deployment config: visible state, safe changes, safe rotation

Operators inherit Selva deployments they did not set up, and are afraid to touch `.env`: they can't
tell what is set, what is a default, or what a change will break. This plan makes the config
self-describing, makes key rotation non-destructive, and gives existing deployments an automatic,
checked migration. Every piece is library code first, so apps built on the engine (parafa) get the
same benefits without the `selva` CLI.

## What goes wrong today

**About 75 variables in one flat file.** [.env.example](../../packages/selva/.env.example) mixes
bootstrap (providers, `DATA_PATH` or `SUPABASE_*`, the two keys, `ORIGIN`), product settings
(branding, flags, SMTP, sign-in max age, sign-up policy), about 20 tunables almost nobody should
touch, and host plumbing (`HOST`, `NODE_ENV`, `BODY_SIZE_LIMIT`, `ADDRESS_HEADER`, `XFF_DEPTH`). The
CLI already writes a ~10-line `.env` for new installs, so the count hurts less than the opacity.

**Nobody can see what is set.** The deployment `.env` is values-only and defaults live in code, so
"set on purpose", "default" and "leftover" look the same. A misspelled key is ignored. A malformed
number falls back to its default with one warn line
([`readPositiveInt`](../../packages/server/src/compute/limits.ts)). Feature flags go through
`readBool` with no logger at all. And `.env` isn't necessarily what the process runs on: Node's
`--env-file` doesn't override existing variables, so pm2's saved env or a compose `environment:`
block silently wins.

**Validation is inconsistent, sometimes fail-open.** `SIGN_IN_MAX_AGE_DAYS` stops boot on a bad value
on purpose ([signInMaxAge.server.ts](../../packages/selva/src/lib/server/signInMaxAge.server.ts)),
while `SUPABASE_ALLOW_EMAIL_LINK_SIGNUP !== 'false'` means `=no` or `=False` allows sign-ups
([SupabaseAuthProvider.ts](../../packages/providers/supabase/src/auth/SupabaseAuthProvider.ts)).
Doctor rejects base64 keys that the runtime accepts and that the runtime's own error text recommends.

**Rotation is destructive, so it never happens.** `SELVA_HMAC_KEY` is read in six places: local
sessions, share links, invites, API tokens, MCP/OAuth client ids and codes, and solve-event tokens.
Changing it kills all of them at once, and MCP client ids carry no expiry, so they break in client
configs that someone has to find and fix. Changing `SELVA_AT_REST_KEY` makes the stored compute API
key unreadable. The warning in [keys.js](../../packages/cli/src/commands/keys.js) is wrong in both
directions: it omits API tokens and MCP clients, and it says "logs everyone out" on Supabase and
header auth, where the key signs no sessions.

**The CLI corrupts `.env` when it rewrites it.** `quoteIfNeeded` uses `JSON.stringify`, which Node's
env parser doesn't unescape: after `selva keys rotate` or `selva init`, a
`SUPABASE_JWT_SIGNING_KEY={"kty":…}` line reads back as `{\`. `BODY_SIZE_LIMIT=256M # note` becomes
`"256M # note"`, which adapter-node can't parse. There are three hand-written `.env` parsers in the
CLI, and `.env` and its backups are written with the default umask.

**What a variable means lives in several places:** the template prose,
[checks/config.js](../../packages/cli/src/checks/config.js),
[ops/deploymentConfig.ts](../../packages/server/src/ops/deploymentConfig.ts) (kept in step by a parity
test), `RENAMED_ENV_VARS` in the CLI plus `readRenamed` calls in the server, the header defaults
copied into the CLI, and upload defaults copied into `api/deps.ts`.

**Downstream apps inherit all of it.** parafa passes the whole of `process.env` into
`createSelvaProviders` because "the engine reads its own keys as an open set", and its `.env.example`
copies engine variable names by hand. Its three token families (`apiTokens/codec.ts`,
`team/inviteToken.ts`, `montage/linkToken.ts`) rotate as destructively as Selva's.

## Goals

- Someone who inherits a deployment answers "what is set, what is default, what is wrong, what
  changed" with one command or one admin page.
- A change can't silently produce a broken or misread `.env`, and every key states what changing it
  breaks.
- Routine key rotation logs nobody out and breaks no link or integration.
- Existing deployments move onto the new shape with a migration that shows its work and can be
  undone.
- Host apps reuse the manifest, resolution and rotation as library code.

Not goals: a secret manager (env stays the root of trust; Vault/Doppler/Infisical work by injecting
env), hot reload of config, and changing how providers are wired (`SELVA_CONFIG_PATH` stays).

## 1. A config manifest: one declaration per key

Each key is declared once, in TypeScript, in the package that reads it:

```ts
defineSetting({
	key: 'SIGN_IN_MAX_AGE_DAYS',
	type: 'int',
	min: 0,
	default: 0,
	onInvalid: 'fail', // security control: fail closed
	sensitive: false,
	impact: 'Lowering it revokes API tokens of anyone who has not signed in within the new window.',
	aliases: [],
	legacyParse: undefined
});
```

Slices: `@selvajs/server/config` (engine core), one per provider package (`SUPABASE_*` next to the
Supabase provider, `HEADER_AUTH_*` next to `@selvajs/header-auth-provider`), and one for the Selva app
itself (`ORIGIN`, `SIGN_IN_MAX_AGE_DAYS`, logging, Sentry). A host composes the slices it ships plus
its own, and declares the external keys it knows about (parafa's `SUPABASE_DB_URL`, the Supabase CLI's
own variables) so they aren't reported as unknown.

`resolveConfig(manifest, env)` returns typed values plus a report per key: value, whether it was set
or defaulted, and whether it was valid. It replaces `readPositiveInt`, `readBool` and `readRenamed`;
`resolveComputeLimits` becomes a view over it.

**Invalid values are a per-key decision.** `onInvalid: 'fail'` stops boot with the key and the rule;
every security control uses it (sign-in max age, sign-up policy, flags, keys). `onInvalid: 'default'`
falls back and reports, for tunables, where a typo in a cache size shouldn't take the site down on
the next unrelated restart. Booleans parse one way everywhere, `true|false|1|0|yes|no`, case
insensitive, anything else invalid. That closes the email-link sign-up fail-open.

**Unknown keys.** Any key under an engine prefix that no slice or host declares is reported with the
nearest declared name (`COMPUTE_SOLVE_DEADLINE`: did you mean `COMPUTE_SOLVE_DEADLINE_MS`?). The scan
reads `process.env`, not SvelteKit's env module, which under Kit 3 exposes declared keys only.

**Keeping the manifest honest.** A test runs every provider's `fromEnv` against a Proxy env and fails
on any key read that no slice declares. Without it, a host passing resolved values instead of
`process.env` loses an undeclared key silently.

**The CLI gets a JSON projection** (keys, types, constraints, defaults, impact), generated and bundled
into the CLI at build time. The CLI can't import the runtime: `@selvajs/*` code is bundled into the
app's `build/`, and `@selvajs/selva` has no exports map. Cross-key rules (`BODY_SIZE_LIMIT` ≥
`COMPUTE_REQUEST_MAX_BYTES`, proxy headers) stay code on both sides with the existing parity test;
the per-key checks, the rename list and the copied defaults go.

## 2. Seeing the config

**Shell: `selva config show`** reads `.env` with `util.parseEnv` (Node's own parser, the one the app
boots with) and prints one row per key: value, set or default, status. `--all` adds every default.
Generated keys (`SELVA_HMAC_KEY`, `SELVA_AT_REST_KEY`) show a fingerprint so two machines can be
compared; other secrets show only "set". A fingerprint of a low-entropy secret like `SMTP_PASS` would
be an offline guessing oracle.

**Shell: `selva config set KEY=VALUE` / `unset KEY`** validate against the manifest, print the key's
`impact`, edit the one line in place (never re-render the file), keep a backup, write both at 0600,
and offer `selva restart`.

**Admin UI: `/admin/system`**, which already shows flags and limits, gets a read-only Configuration
section, built in the page's server load: session-only, instance admins only. Nothing is editable there;
changes go through `.env` and `config set`. The top of the section shows only the keys marked
`summary: true` in the manifest, the ones an admin needs at a glance: auth and data providers,
`ORIGIN`, key status (fingerprint, `_PREVIOUS` present), `SIGN_IN_MAX_AGE_DAYS`,
`BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, the proxy settings and `BODY_SIZE_LIMIT`. Below that come problems
(invalid, unknown, overridden) and what changed since the last boot. Everything else sits under a
collapsed "All settings". Not an `/api/v1` route, which accepts API tokens with org-wide scopes,
and not `/api/health`: its body is public and its status is binary, and a 503 makes the self-update
runner roll back. A host app calls `buildConfigReport` and renders it however it likes.

**The process view vs the file view.** The admin page shows what the process runs on. At boot the
app also writes `.selva-config-snapshot.json` (0600) to the deployment directory: non-sensitive
values in clear, sensitive ones as salted fingerprints. That file is what lets the CLI say:

- what changed since the last boot, old value → new value ("what changed since it last worked")
- `.env` was edited but the app wasn't restarted
- the running process differs from `.env`: something else (pm2's saved env, compose) is overriding it

It lives beside `.env` rather than in the data provider. It has to survive a change of `DATA_PATH`
or `SUPABASE_URL`, which are exactly the changes worth catching. It also has to work on the local
provider, which discards audit events. On Cloud Run each instance has its own file and nothing
compares across instances, so rollouts don't produce false alarms.

## 3. Key changes that break nothing

**Stored token hashes stop using a key.** Share links, invites and API tokens are 32 random bytes or
more, so unkeyed SHA-256 is as unreplayable from a database leak as HMAC is. GitHub stores token
hashes this way. A lookup tries the SHA-256 form first, then the HMAC form under the current and the
previous key (`findByToken`). Stores keep their single-hash `getByTokenHash`, so there is no store
change and no Supabase migration, and because nothing rewrites a row on use there is no rewrite for a
lookup to race. A token that is not found costs three lookups instead of one.

Legacy rows keep needing `SELVA_HMAC_KEY` or its `_PREVIOUS`. Invites (7 days) and API tokens (180
days at most) age out; share links have no expiry, so a legacy share link dies on `--finish` or
`--leaked`. Rewriting a row to SHA-256 on use would fix that, at the cost of a `rehash` on three
stores in two providers: worth doing if old share links turn out to matter.

What gives way: with a keyed hash, someone with database write access can't plant a token hash of
their choosing; with SHA-256 they can. Write access to the token tables already allows granting
admin rights directly, so the key protects little.

**`SELVA_HMAC_KEY` then signs only short-lived things**: local session cookies, OAuth codes,
solve-event tokens, plus MCP client ids. Rotation becomes a verify-only overlap:
`SELVA_HMAC_KEY_PREVIOUS` (one value, no list; the key may legally contain commas) still verifies,
the new key signs.

**The overlap is bounded.** `keys rotate` writes `<KEY>_PREVIOUS_EXPIRES` 30 days out, and the app
refuses the previous key past it on its own; an unreadable date counts as passed. Rotation exists to
limit how long a key that leaked unnoticed stays useful, so leaving the old key accepted until
someone remembers `--finish` would undo it. A previous key set by hand without a deadline is
accepted and flagged on `/admin/system` and by doctor.

For the overlap to end cleanly, what it protects has to expire first. Sessions (8 hours), invites (7
days) and API tokens (180 days at most) do. Share links now default to 90 days; an explicit
`expiresAt: null` still means never. MCP client ids are the remaining exception: they are signed and
never expire (see open questions).

**`SELVA_AT_REST_KEY` gets the same `_PREVIOUS`.** AES-GCM authenticates, so trying both keys is safe
and the `enc:v2` envelope doesn't change. Re-encryption is a separate `reencryptSecrets()`, run once
per process from boot health before `verifySecrets`. The local store does it under the file lock; the
Supabase store updates a row only if it still holds the old ciphertext (compare-and-swap).
`verifySecrets` stays read-only: the admin health GET calls it too, and a GET that writes would race
admin edits on `/admin/compute`.

**A changed key shows up at boot.** The config snapshot (§2) holds each key's fingerprint, so a boot
with a different `SELVA_HMAC_KEY` appears under "changed since the last start" on `/admin/system`
and in the log. A dedicated warning ("changed without `_PREVIOUS`: MCP clients made before this
boot will fail") is not built yet.

The CLI flow:

```
selva keys rotate hmac            # current -> _PREVIOUS, new current, restart. Nobody notices.
selva keys rotate hmac --finish   # drops _PREVIOUS once the overlap has passed
selva keys rotate hmac --leaked   # drops the old key at once; lists the .env backups still holding it
```

Each warning names what the key covers **on this deployment's providers**: no "logs everyone out" on
header auth or Supabase.

**The real size of the change.** `SELVA_HMAC_KEY` has six readers and the at-rest key is decoded
inside each provider's `fromEnv`; each takes the previous key now. parafa has three codecs of its own
and a `MontageLinkStore`: passing `previousSecret` to `createTokenCodec` and looking up through
`findByToken` is all it needs.

**Two root keys stay.** One signs, one encrypts. A single master key with HKDF subkeys saves one line
nobody types and couples every rotation to both. With token hashes unkeyed, per-family secrets matter
even less.

## 4. Fewer knobs

- `ALLOW_INSECURE_COOKIES` defaults from the `ORIGIN` scheme: `http://` drops the `Secure` flag and
  the admin page warns. The variable stays as an override and enters the template. This changes
  behaviour for an http install that never set it: login starts working. It goes in the release
  notes.
- `SELVA_RELEASE` should default to the installed package version (not built yet).
- Each tunable gets the question "has anyone had a reason to change this?". No means it leaves the
  manifest, and the migration removes it from `.env`. First candidates: `SUPABASE_PRIVATE_URL_PREFIX`,
  the bucket names, `REMOTE_DEFINITION_FETCH_TIMEOUT_MS`, `REMOTE_DEFINITION_CACHE_TTL_MS`,
  `COMPUTE_RESPONSE_MAX_BYTES`, `HEADER_AUTH_DATA_DIR`.
- The generated template puts tunables in a trailing "advanced" block, so the top of it is the eight
  or so keys an operator actually decides.

Who owns `HOST`, `ADDRESS_HEADER` and `XFF_DEPTH` is a property of the deployment, not the key: the
CLI scaffold, compose in parafa, the operator by hand on the Entra install. `config show` reports
what the snapshot can tell (set, default, overridden); it doesn't claim an owner.

The Entra customer's `.env` (header auth, local data, behind a hand-written Caddyfile) ends up as:

```
SELVA_AUTH_PROVIDER=header
SELVA_HMAC_KEY=…
SELVA_AT_REST_KEY=…
DATA_PATH=/var/lib/selva
ORIGIN=https://selva.example.com
BOOTSTRAP_INSTANCE_ADMIN_EMAIL=admin@example.com
SIGN_IN_MAX_AGE_DAYS=7
HOST=127.0.0.1
ADDRESS_HEADER=X-Forwarded-For
XFF_DEPTH=1
BODY_SIZE_LIMIT=256M
```

## 5. Migrating existing deployments

One deployment needs migrating: the customer on Entra (header auth through oauth2-proxy and Caddy,
local data and storage). The machinery is general because every future rename needs it, but the
first run is planned around that one deployment.

**The first upgrade is run by old code.** The admin self-update runner is built by the running,
pre-update runtime, and `selva update` is the already-loaded old CLI. Neither knows the new
migration. So the first migration is run explicitly with the new CLI, on the customer's server:

```
npx @selvajs/cli@<new> config show          # inventory: what did we set? Read-only.
npx @selvajs/cli@<new> migrate --dry-run    # the full report, nothing written
npx @selvajs/cli@<new> migrate              # apply, with backup
```

The dry run on their own server is the rehearsal: nothing leaves the host, and every derivation sees
their real values. A copy with values replaced would change which rules fire.

**What the migration does, line by line,** editing in place rather than re-rendering:

| A key in `.env` that is                                                                  | becomes                                                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| current, canonical value                                                                 | kept                                                           |
| current, value in a form whose parsing changed (`=1`, `=False`)                          | rewritten to the canonical value it meant under the old parser |
| an old name                                                                              | renamed                                                        |
| a no-op: header names set to their defaults, `HEADER_AUTH_DATA_DIR` equal to `DATA_PATH` | removed                                                        |
| retired                                                                                  | removed, listed in the report                                  |
| unknown                                                                                  | kept and reported: never delete a line nobody understands      |

Shipped template prose goes too, through the existing `stripEnvComments`, which keeps operators' own
one-line notes.

**It proves behaviour didn't change, for the keys where that can be proven.** Resolving both files
under the new manifest would only prove the rewrite is lossless under the new rules. So a key whose
parsing changed carries `legacyParse` in the manifest, and the check compares what the old parser
made of the old line with what the new parser makes of the new one. The file written to disk is read
back with `util.parseEnv` before the check, so a writer bug fails the migration instead of shipping.
Any difference refuses the migration before anything is written. Changed defaults and derivations
(`ALLOW_INSECURE_COOKIES`) belong in the release notes, because the old build is gone by then and
can't be asked.

**Undoing it.** `migrate` keeps a timestamped `.env` backup (0600) and `migrate --undo` restores the
latest, keeping the file it replaces so an undo can be undone. A migration that only touches `.env`
skips the reinstall and the restart. Not built yet: `selva update` and the self-update runner calling
the migration after installing, restoring `.env` on a failed health check, and refusing to write
when the CLI runs as a different user than the app.

**Old names: shims stay one more release.** Release N ships the migration and still reads old names,
with a warning. Release N+1 stops reading them, and an old name at boot becomes a boot error naming
the fix (`MAX_SOLVE_DURATION_MS was renamed to COMPUTE_SOLVE_DEADLINE_MS: run selva migrate`). N+1
waits until the customer's deployment has migrated. Docker and Cloud Run deployments never run the
migration, so for parafa N+1 is a breaking release it adopts deliberately.

**The token switch needs no data migration.** Legacy HMAC rows keep resolving through the
multi-hash lookup, so the upgrade touches no token records.

**The Entra deployment specifically:**

- Header auth means `SELVA_HMAC_KEY` signs no sessions there. Rotating it today kills their share
  links, invites, API tokens and MCP clients, not their logins. After §3 it kills only unrewritten
  legacy share links and MCP clients.
- Local data means no Supabase migration is needed for them.
- Doctor reds a header-auth install without `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, and the Entra guide has
  them set `SIGN_IN_MAX_AGE_DAYS=7` as the backstop for leavers. Both are `onInvalid: 'fail'`.
- The rotation they will actually face is the Entra client secret in `/etc/oauth2-proxy.cfg`, which
  expires after at most 24 months. Selva can't read that file, but the Day-2 section of the Entra
  guide should carry the expiry date and the steps.

## Deferred: settings in the admin UI

The first draft moved branding, SMTP, sign-in max age, sign-up policy and logging into a settings
store edited from the admin UI, and had the migration move them out of `.env`. Deferred, for these
reasons:

- It creates a second source of truth with precedence rules, the confusion this plan exists to
  remove.
- Bootstrap order: provider factories take `(env) => T` and the logger exists before the providers,
  so several "settings" are needed before a store could be read.
- Failure modes get worse for the one customer. An unreadable `settings.json`, or a rollback that
  restores old packages that never read it, silently turns `SIGN_IN_MAX_AGE_DAYS` off. That is the
  control the Entra guide relies on for people who leave.
- Most of these values are boot constants today (`LOG_LEVEL`, compute debug, sign-in max age,
  Supabase sign-up policy), so "change it in the UI" also means making them live.
- parafa reads none of them except sign-up policy, and pins its brand in code.

Revisit when an admin without shell access needs to change branding or SMTP. The manifest is the
foundation either way: a store would be one more source for `resolveConfig`, and every key already
declares whether it is safe to change at runtime.

## What a host app gets

| Piece                                | What parafa does with it                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| manifest slices and `resolveConfig`  | composes engine + Supabase + its own slice; validates at boot with per-key failure policy; stops passing an open-ended `process.env`; generates its `.env.example` |
| Proxy-env test                       | proves every key the engine reads is declared                                                                                                                      |
| unkeyed token hashes and `_PREVIOUS` | graceful rotation for `INVITE_TOKEN_SECRET`, `API_TOKEN_SECRET`, `SELVA_AT_REST_KEY`; needs its own store and migration changes (§3)                               |
| config report as a function          | renders it in its own admin UI                                                                                                                                     |

Not for parafa: the `selva` CLI (it deploys with compose and Cloud Run), and the deployment-config
rules as they stand. `checkClientAddress` treats `HOST=0.0.0.0` and a missing `ORIGIN` as warnings,
while parafa's compose binds 0.0.0.0 by necessity and uses `x-real-ip` plus `PROTOCOL_HEADER` with no
`ORIGIN`. Those rules need a topology input before a host can run them.

Generating parafa's SvelteKit 3 `defineEnvVars` from the manifest was dropped: parafa's `src/env.ts`
lists only app-owned keys on purpose, and Kit 3 fails boot on any invalid value, which contradicts
the per-key policy. Exporting `resolveConfig` is enough.

## Dependency order

The manifest comes first, because the report, `config set`, the migration and the boot snapshot all
read it. The CLI `.env` writer has to be replaced (line-level edits, `util.parseEnv`) before the
migration or `config set` can be trusted. The token-hash switch and the keyring don't depend on the
manifest. The migration ships in release N and runs on the customer's server before release N+1
drops the shims.

## Found while writing this: live bugs, unfiled

These stand on their own and should be filed as issues, independent of the plan:

- The CLI `.env` writer corrupts JSON values and inline comments, and drops operators' notes
  (`env.js` `quoteIfNeeded`, `renderEnvValues`).
- `keys.js` blast-radius text is wrong both ways (see "What goes wrong today").
- `SUPABASE_ALLOW_EMAIL_LINK_SIGNUP` fails open on anything but the exact string `false`.
- Doctor's `HEX_64` check reds valid base64 keys that the runtime accepts.
- `.env` and its backups are written with the default umask.
- Feature flags parse through `readBool` with no logger, so a typo is silently "off".

## Rejected

- **A structured config file (TOML, `selva.config.json`) instead of `.env`.** The problem is
  visibility and validation, not syntax. pm2, Docker and Cloud Run all speak env.
- **All config in the database.** Bootstrap has to exist before the database does, and recovery has
  to work when the UI doesn't.
- **One master key with HKDF subkeys.** See §3.
- **One invalid-value policy for every key.** Failing boot on a cache-size typo is too harsh; falling
  back to "off" on a security control is fail-open.
- **A `SELVA_PROVIDER` shortcut for the three provider variables.** Saves no lines on local or header
  stacks and adds a precedence rule.
- **Loading check code from the installed runtime in the CLI.** The runtime is bundled into `build/`
  with no exports map; there is nothing to import.
- **Showing fingerprints for every secret.** An oracle for low-entropy ones; fingerprints only for
  generated keys.
- **Dropping the shims in the release that ships the migration.** The first upgrade is run by old
  code that doesn't know the migration; the site would fail to boot.

## Open questions

- MCP client ids are signed and never expire, so clients registered before a rotation have to
  register again once the overlap ends. Make them expire and rely on re-registration, or store
  registrations instead of signing them? Tracked in
  [#342](https://github.com/VektorNode/selva/issues/342).
- Should the deployment-config rules take an explicit topology (`proxied`, `container`, `direct`)
  so parafa can run them, or stay Selva-only?
- `SUPABASE_JWT_SIGNING_KEY` rotation is Supabase's own flow. Should the report at least show which
  key the project currently signs with?
