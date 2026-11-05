# Can Selva sign a JWT that Supabase RLS accepts?

**Tracked in #313.** Researched 2026-10-07 against `@supabase/supabase-js` 2.117.2 (auth-js and
postgrest-js 2.117.2), Supabase Auth (GoTrue) v2.196.0 and PostgREST v14.17, the versions the
self-hosted `docker-compose.yml` pins today.

## Answer

Yes. Mint an **ES256** JWT with the `kid` of a key Supabase trusts, carrying `sub`, `role`, `aud`,
`exp`. PostgREST verifies the signature against the project's keys, `SET ROLE authenticated`, and
`auth.uid()` reads `sub`. No GoTrue session is needed. Selva's RLS only calls `auth.uid()`
(`packages/providers/supabase/supabase/migrations/*.sql`), so no other claim matters to it.

Recommended: an asymmetric key the operator generates with `supabase gen signing-key --algorithm
ES256` and gives to both Supabase and Selva. The legacy HS256 secret works too, but only while the
project has not revoked it.

## The bullets

### Importing a custom signing key (hosted, asymmetric default)

- Supabase documents exactly this use: "If you wish to make your own JWTs … you can create a new
  JWT signing key by importing a private key". Generate with `supabase gen signing-key --algorithm
ES256`, import it as a **standby** key in Dashboard → Settings → JWT, then click **Rotate key**.
  The private key is not extractable afterwards, so Selva keeps its own copy.
  ([signing-keys § How to create (mint) JWTs](https://supabase.com/docs/guides/auth/signing-keys#how-to-create-mint-jwts-if-access-to-the-private-key-or-shared-secret-is-not-possible))
- The minted header must be `{"alg":"ES256","kid":"<imported kid>","typ":"JWT"}`; "You must use
  the same value when importing on platform." (same section)
- **A standby key is not trusted.** The key-lifetime table lists accepted signatures after "Create
  a new key" as "Current key only". Trust starts at rotation: "Both keys in the rotation", until
  revoke. ([Lifetime of a signing key](https://supabase.com/docs/guides/auth/signing-keys#lifetime-of-a-signing-key))
  So the documented path makes the imported key **the key Supabase Auth itself signs user sessions
  with**. A key left as _Previously used_ stays trusted until someone revokes it, but the docs tell
  operators to revoke previously-used keys once old tokens expire, so don't rely on that state.
- Algorithm: use ES256. EdDSA is "Coming soon" on the platform (same page), and auth-js
  `getAlgorithm` only handles `RS256`/`ES256`
  (`node_modules/.pnpm/@supabase+auth-js@2.117.2/.../src/lib/helpers.ts:544`).
- Key-state changes are throttled for about 5 minutes (signing-keys FAQ).
- The `apikey` header still has to be a publishable/anon key: "Using your minted JWT is not possible
  in this header." `forRequest` already does this (anon key + `Authorization: Bearer`).

### Legacy HS256 JWT secret as fallback

- It works while the project still trusts it. On a migrated project the legacy secret sits under
  _Previously used_, and its tokens stay valid until it is revoked
  ([signing-keys § Getting started](https://supabase.com/docs/guides/auth/signing-keys#getting-started)).
  It is the only secret Supabase lets you extract ("You can only extract the legacy JWT secret").
- Supabase advises against it ("Not recommended for production applications"; a leaked secret can
  be used "far into the future"), and the migration guide ends with revoking it. An operator who
  follows that guide silently breaks Selva's delegated sessions. Treat HS256 as a fallback for
  projects that never migrated, not a default.
- Sign HS256 without a `kid`. GoTrue falls back to the legacy secret for `alg: HS256` with no
  matching kid ([auth.go#L102-L106](https://github.com/supabase/auth/blob/v2.196.0/internal/api/auth.go#L102-L106)).

### Claims PostgREST requires

| Claim                   | Needed by            | Notes                                                                                                                                                                                                             |
| ----------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role: "authenticated"` | PostgREST            | Selects the DB role. No role claim means PostgREST uses the anon role ([PostgREST auth](https://docs.postgrest.org/en/v14/references/auth.html)).                                                                 |
| `sub: <auth.users.id>`  | RLS, GoTrue          | `auth.uid()` reads it. Supabase calls it optional only because a role-only token is valid.                                                                                                                        |
| `exp`                   | PostgREST, getClaims | Supabase: "Prefer shorter-lived tokens." PostgREST allows 30 s clock skew on `exp`/`iat`/`nbf`.                                                                                                                   |
| `aud: "authenticated"`  | GoTrue `/user`       | PostgREST ignores a missing `aud` and checks it only when `jwt-aud` is configured. GoTrue `GET /user` **rejects a token without `aud`** (see below). Always set it.                                               |
| `iat`                   | none                 | Validated if present. Set it.                                                                                                                                                                                     |
| `iss`                   | nobody               | Neither PostgREST nor GoTrue checks it. Optional; `${SUPABASE_URL}/auth/v1` matches real tokens.                                                                                                                  |
| `session_id`            | **omit**             | If present, GoTrue looks it up in `auth.sessions` and returns 403 `session_not_found` when it doesn't exist ([auth.go#L146-L157](https://github.com/supabase/auth/blob/v2.196.0/internal/api/auth.go#L146-L157)). |

The documented minimal payload is `{sub, role, exp}` ([signing-keys](https://supabase.com/docs/guides/auth/signing-keys#how-to-create-mint-jwts-if-access-to-the-private-key-or-shared-secret-is-not-possible)).
That is enough for PostgREST but not for `getUser`.

### `auth.getClaims()` and `auth.getUser()` with a minted JWT

**`getClaims(token)`** (auth-js 2.117.2, `src/GoTrueClient.ts:6690-6798`) checks only:

1. `exp` is present and in the future;
2. for `alg` RS256/ES256 with a `kid`: the `kid` is in `/auth/v1/.well-known/jwks.json` (cached
   in memory for 10 min, `JWKS_TTL`), and the signature verifies;
3. for HS* or a missing `kid`: it falls back to `getUser(token)`.

It does **not** check `aud`, `iss` or `role`. A minted ES256 token signed with a key in the JWKS
passes. Supabase still says `getClaims()` "is meant to be used only with JWTs issued by Supabase
Auth. If you mint your own JWTs using a key you've imported, the verification may fail"
([jwts § custom JWTs](https://supabase.com/docs/guides/auth/jwts#using-custom-or-third-party-jwts)).
That is a support boundary, not a failure the source shows today. One mismatch to know about: the
JWKS advertises standby keys, so `getClaims` accepts a token that PostgREST would reject.

**`getUser(token)`** calls GoTrue `GET /user`. GoTrue:

- verifies the signature against its configured keys or the legacy secret
  ([auth.go#L83-L116](https://github.com/supabase/auth/blob/v2.196.0/internal/api/auth.go#L83-L116));
- requires `sub` to be a UUID of an existing user, and rejects banned users
  ([auth.go#L118-L144](https://github.com/supabase/auth/blob/v2.196.0/internal/api/auth.go#L118-L144), [#L36-L39](https://github.com/supabase/auth/blob/v2.196.0/internal/api/auth.go#L36-L39));
- loads a session **only if** `session_id` is present;
- in `UserGet`, requires `aud[0]` to equal the request audience (default `GOTRUE_JWT_AUD`, which is
  `authenticated`). A token **with no `aud` gets 400** "Token audience doesn't match request
  audience" ([user.go#L64-L79](https://github.com/supabase/auth/blob/v2.196.0/internal/api/user.go#L64-L79)).

So a minted token with `aud: "authenticated"` and no `session_id` passes `getUser`, and so does
`SupabaseAuthProvider.verifyToken` in both modes. Without `aud` it fails `getUser`, which means
`'strict'` mode, the hybrid revalidation and the HS256 path of `getClaims` all fail.

### Self-hosted

- Keys live in `.env`, with no dashboard rotation. `JWT_KEYS` is a JSON array of private JWKs that
  Auth reads as `GOTRUE_JWT_KEYS`, and exactly one key may carry `key_ops: ["sign"]`
  ([jwk.go#L112-L123](https://github.com/supabase/auth/blob/v2.196.0/internal/conf/jwk.go#L112-L123)).
  `JWT_JWKS` holds the public key plus the legacy secret as an `oct` JWK; PostgREST, Storage,
  Realtime and Functions read it (`PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}`).
  `utils/add-new-auth-keys.sh` generates both
  ([self-hosted auth keys](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys),
  [docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)).
- Without `JWT_KEYS`/`JWT_JWKS` the stack is HS256-only on `JWT_SECRET`, and the HS256 path is the
  only option.
- Rotation means regenerating the keys and running `sh run.sh recreate`. Regenerating "invalidates
  all ES256 user sessions"; there is no overlap window unless the operator hand-merges the old public
  key into `JWT_JWKS`.
- `GOTRUE_JWT_AUD: authenticated` is set and `PGRST_JWT_AUD` is not, so `aud` behaves as described
  above. The Envoy gateway passes a real JWT in `Authorization` through untouched. It only builds
  that header itself when the client sent no JWT
  ([self-hosted Envoy § Authorization synthesis](https://supabase.com/docs/guides/self-hosting/self-hosted-envoy)).
- Simplest setup: Selva signs with the same EC private JWK that is in `JWT_KEYS` (same `kid`). A
  separate Selva key also works: append its public JWK to `JWT_JWKS`, which is enough for
  PostgREST. Add it to `JWT_KEYS` as a verify-only entry too if anything will call `getUser` with
  these tokens. The verify-only entry follows from the GoTrue source above but no doc covers it.
- Supabase CLI (local dev): set `[auth] signing_keys_path = "./signing_keys.json"` in
  `supabase/config.toml`, filled from `supabase gen signing-key`
  ([CLI config template](https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/templates/config.toml)).
  Selva's `config.toml` doesn't set it today, so the local stack runs HS256.
  `supabase gen bearer-jwt --role authenticated --sub <uuid>` mints a test token.

## Recommendation

Mint per delegated request, server-side, with `node:crypto` (`dsaEncoding: 'ieee-p1363'`, as
Supabase's own `add-new-auth-keys.sh` does). No new dependency.

```jsonc
// header
{ "alg": "ES256", "kid": "<operator's kid>", "typ": "JWT" }
// payload
{ "sub": "<userId>", "role": "authenticated", "aud": "authenticated",
  "iat": now, "exp": now + 300, "iss": "<SUPABASE_URL>/auth/v1" }
```

Hardcode `role: "authenticated"`; never let a caller choose it. Leave out `session_id`.

### Operator setup

**Hosted**

1. `supabase gen signing-key --algorithm ES256` and keep the JWK in the secret store.
2. Dashboard → Settings → JWT signing keys → create a standby key by importing that JWK.
3. **Rotate key** (wait out the ~5 min throttle). The project trusts it from here on, and Supabase
   Auth signs new sessions with it.
4. Give Selva the private JWK, for example in a new `SUPABASE_JWT_SIGNING_KEY` env var.
5. Rotating later: import a new key and rotate to it, update Selva's env, and only then revoke the
   old key.

**Self-hosted**

1. `sh utils/add-new-auth-keys.sh --update-env`, then `sh run.sh recreate`.
2. Copy the `kty: "EC"` entry from `JWT_KEYS` into Selva's `SUPABASE_JWT_SIGNING_KEY`.
3. Rotating means regenerating the keys and updating Selva in the same maintenance window.

**Legacy fallback** (an unmigrated project, or self-hosted on HS256 only): Selva signs HS256 with
`JWT_SECRET`, no `kid`. This breaks as soon as the operator revokes the legacy secret.

## What this changes for delegated sessions

- **The key is a root credential.** Whoever holds it can mint `service_role` tokens. On hosted it
  is also the key Supabase Auth signs every user session with. That is no worse than the
  `SUPABASE_SERVICE_ROLE_KEY` Selva already holds, but a leak means rotating the signing key, not
  just revoking an API key. Add the env var to log redaction.
- **Nothing in Supabase can revoke a minted token.** There is no session to sign out, and PostgREST
  never checks bans. Revocation is bounded by the TTL, so Selva must check the `sk_` token and the
  user's `disabled` state before minting.
- **Don't route minted tokens through `verifyToken`.** The `sk_` path authenticates on Selva's own
  token store. If that ever changes: `getClaims` passes, and hybrid revalidation keys on `sub`
  because there is no `session_id`.
- **Selva is coupled to the operator's key rotation.** If the operator revokes the key Selva holds,
  every delegated request fails until Selva's env is updated. The rotation steps go in the operator
  runbook. A startup check that the configured `kid` is in the project's JWKS catches a revoked
  key early, though not a key that is still standby.

### Open, needs a live check

- That hosted PostgREST rejects a token signed by a **standby** key. The docs say so, but no one has
  tested it.
- Whether hosted PostgREST sets `jwt-aud`. It doesn't matter as long as `aud: "authenticated"` is
  sent.
- An end-to-end run on the local CLI stack with `signing_keys_path`: mint a token, then a PostgREST
  read under RLS, then `getUser`.

## Live verification (2026-10-07)

This was run on a scratch local stack: Supabase CLI 2.118.0, GoTrue v2.197.0, PostgREST v16.3, supabase-js 2.117.2.

Setup:

- Generate the key with `supabase gen signing-key --algorithm ES256`, wrapped as a JSON array.
- Set `[auth] signing_keys_path = "./signing_keys.json"`.
- Create a table with an RLS policy of `owner = auth.uid()`.
- Create a real user with `auth.admin.createUser`.
- Sign with `node:crypto`: `crypto.sign('sha256', header.payload, { key: <private JWK>, dsaEncoding: 'ieee-p1363' })` and header `{alg: ES256, kid, typ: JWT}`.

| Token                                             | PostgREST          | `getUser`                 | `getClaims` |
| ------------------------------------------------- | ------------------ | ------------------------- | ----------- |
| `sub`, `role`/`aud` = `authenticated`, `exp` +300 | 200, own rows only | ok                        | ok          |
| same, no `aud`                                    | 200, own rows only | **400** audience mismatch | ok          |
| expired                                           | 401 `PGRST303`     | 403 `bad_jwt`             | rejected    |
| foreign key, project `kid`                        | 401 `PGRST301`     | 403                       | rejected    |
| foreign key, unknown `kid`                        | 401 `PGRST301`     | 403                       | rejected    |
| `role: service_role`                              | **200, every row** | ok                        | ok          |
| valid token, user **banned**                      | **200, own rows**  | 403 `user_banned`         | ok          |

What this confirms:

- The design works, provided `aud` is always set.
- The signing key can mint `service_role`, so it carries the same weight as the service key.
- PostgREST ignores bans and deletions. Selva must re-check the user's state before every mint, and the TTL bounds what is left exposed.

Not testable locally: hosted PostgREST rejecting a token signed with a standby key.
