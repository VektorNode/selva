---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/selva': minor
'@selvajs/cli': minor
---

Deployment config you can see, change safely and rotate without breaking anything.

- **Every env var is declared once**, with its type, default, what changing it affects and whether a bad value stops boot (`@selvajs/platform/config`, plus a slice per package: `@selvajs/server/config`, `@selvajs/*-provider/config`). A host app composes the slices it ships and calls `resolveConfig` or `buildConfigReport`.
- **`selva config show`** lists what `.env` sets, what is default, what is wrong, keys Selva doesn't read (with the likely intended name), and what differs from what the app last booted with. **`selva config set KEY=VALUE`** checks the value and edits only that line, with a backup. `/admin/system` shows the same report to instance admins, read-only.
- **A bad value on a security control now stops boot** instead of silently falling back. `SUPABASE_ALLOW_EMAIL_LINK_SIGNUP` used to read anything but the exact string `false` as on, so `=no` allowed sign-ups; booleans now accept `true|false|1|0|yes|no|on|off` and nothing else.
- **Key rotation keeps the old key working.** `selva keys rotate hmac` (or `at-rest`) moves the old key to `SELVA_HMAC_KEY_PREVIOUS` / `SELVA_AT_REST_KEY_PREVIOUS`, which sessions, OAuth/MCP clients, solve-event tokens and stored compute API keys still accept. Boot re-seals API keys under the new at-rest key. The previous key is accepted for 30 days (`<KEY>_PREVIOUS_EXPIRES`), then refused on its own; `/admin/system` and `selva doctor` count down to it. `--finish` ends the overlap early, `--leaked` drops the old key at once.
- **Share links expire after 90 days by default.** A link minted without `expiresAt` gets one; an explicit `expiresAt: null` still means never. The mint dialog has expiry on by default.
- **Share-link, invite and API tokens are stored as an unkeyed SHA-256.** New tokens no longer depend on `SELVA_HMAC_KEY`; tokens stored before keep resolving under the current or previous key. `createTokenCodec` takes `previousSecret`, and `findByToken` looks a token up by every hash form its record may carry.
- **`selva migrate --dry-run`** shows the `.env` rewrite (renamed keys, values a looser reader used to accept, no-op lines, shipped template prose) and proves every setting keeps its meaning before writing. `--undo` restores the backup.
- **The CLI no longer corrupts `.env` when it rewrites it.** A JSON value such as `SUPABASE_JWT_SIGNING_KEY` came back as `{\`, and an inline comment ended up inside the value. Rewrites now edit single lines, read back with Node's own parser, and write `.env` and its backups as `0600`.
- **An `http://` `ORIGIN` drops the `Secure` cookie flag**, so sign-in over plain HTTP works without `ALLOW_INSECURE_COOKIES`, which still overrides either way.
- `selva doctor` accepts a 32-byte base64 key, as the runtime does.
