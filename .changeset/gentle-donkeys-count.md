---
'@selvajs/selva': patch
---

Say why an update rolled back instead of printing the raw health body and stopping.

The runner already fetched `/api/health` and printed its response before rolling back, but nothing parsed it. An operator whose update failed because the Supabase migrations for the new version had not been applied saw a wall of JSON, a rollback, and no statement of cause — so the obvious next move was to retry, which fails identically every time. The database, not the release, was the thing needing attention, and nothing said so.

The rollback path now classifies that response and names the cause. A schema mismatch prints a `SCHEMA_SKEW` marker carrying both migration heads and the two commands that fix it (`sync-migrations`, then `supabase db push`), and says outright that retrying without them repeats the same failure. A compute-key decryption failure gets the same treatment under `AT_REST_SECRETS`. A response matching neither says so plainly rather than staying silent.

`deriveOutcome` classifies both markers ahead of the generic rollback case, so the admin UI headline names the version skew and the detail carries the fix — the generic "review the log below for why the new version failed" was actively misleading here, since the log holds nothing about the new version.

Both markers state that Selva does not apply migrations during an update. That is deliberate and worth an operator knowing: migrations are not reversible, so auto-applying them and then rolling the code back on any unrelated health failure would strand the app and the database on different heads, and the rollback is only trustworthy because it stays out of the database.

Not addressed: the check still runs after the app has been stopped, so a skewed deployment takes the full probe window of downtime before rolling back. Catching it during pre-flight needs the target version's expected migration head before install, which is only readable from inside the package tarball.
