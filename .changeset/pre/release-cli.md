---
'@selvajs/cli': minor
---

Config inspection, safe key rotation, `.env` migration, and updates that catch a database behind the app.

- `selva config show` lists what `.env` sets, what is default, what is invalid, keys Selva doesn't read (with the likely intended name), and what differs from the last boot. `selva config set KEY=VALUE` validates the value and edits only that line, with a backup.
- `selva keys rotate hmac|at-rest` moves the old key to `SELVA_HMAC_KEY_PREVIOUS` / `SELVA_AT_REST_KEY_PREVIOUS`, accepted for 30 days (`<KEY>_PREVIOUS_EXPIRES`). `--finish` ends the overlap early, `--leaked` drops the old key at once. `selva doctor` counts down to expiry.
- `selva migrate --dry-run` shows the `.env` rewrite (renamed keys, values a looser reader used to accept) and proves every setting keeps its meaning before writing. `--undo` restores the backup.
- `selva update` installs `@selvajs/supabase-provider` on the runtime's channel, polls `/api/health` after the restart, and exits non-zero with the migration commands when the app comes up degraded. `selva doctor` checks the database against the migration head the app expects.
- Fixed: rewriting `.env` no longer corrupts JSON values or pulls inline comments into a value. `.env` and its backups are written `0600`. `selva doctor` accepts a 32-byte base64 key.
