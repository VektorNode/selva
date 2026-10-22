---
'@selvajs/selva': patch
---

When an update rolls back because the database migrations are behind, the fix it prints now installs `@selvajs/supabase-provider` from the channel being updated. On the beta channel it said `@latest`, which installs the stable provider: that ships none of the beta's migrations, so `db push` reported "up to date" and the next update failed the same way.
