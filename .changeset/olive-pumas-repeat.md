---
'@selvajs/supabase-provider': patch
'@selvajs/cli': patch
---

Fix the migration-sync command that every error message told operators to run.

The bin is `selva-supabase`, and the script is the whole command — it takes no subcommand. But its own `--help` output, and the header comment above it, both printed `npx @selvajs/supabase-provider sync-migrations`, which the same file's argument parser rejects with `unknown argument: sync-migrations`. Anyone who ran `--help` instead of finding the operator docs got a command that cannot work.

`SupabaseDataProvider.verifySchemaVersion` embedded the same broken form in the message it surfaces through `/api/health`, so it reached operators at the exact moment they were stuck.

`doctor`'s three migration-head failures said "Sync + run: npx supabase db push" without ever naming the sync step, leaving the reader to guess half the fix. They now give both commands.

The scaffold's next-steps block told a first-time operator to run `supabase link` but never `supabase login`. `link` needs a Supabase _account_ credential, which is none of the three project keys the prompts just collected — the most common first-run stall. It now names the login step and says why the `.env` keys don't cover it.

Also fixes a dead anchor in the provider README pointing at a heading that does not exist.
