---
'@selvajs/supabase-provider': minor
'@selvajs/server': minor
'@selvajs/selva': patch
---

Erasing a user no longer takes shared data with them, and a compute save can no longer lose servers, keys or defaults.

Erasure on Supabase: `owner_id` on orgs, projects and definitions and `uploaded_by` on versions now go null when the user is deleted, and the stores read that as the erased actor. An org, or a project someone else works in, used to be deleted along with its creator, and the uploader of someone else's live version couldn't be erased at all. `DELETE /api/admin/users/[id]` now answers 409 for the only owner of an org: make someone else an owner, or delete the org, first.

Compute saves:

- On Supabase, `savePlatformServers` and `saveOrgServers` run in one transaction, through the new `save_platform_compute_servers` and `save_org_compute_servers` RPCs. A failed save leaves the stored set alone, and an unchanged server keeps its org defaults.
- `validateIncomingServers` refuses a server id that isn't a UUID, a repeated id, a `timeoutMs` outside 1000 to 300000 and a `retryCount` outside 0 to 5. An id already used by another org or the platform answers 409 on Supabase.
- A save that leaves `apiKey` out for a key that can't be decrypted answers 409 instead of overwriting the ciphertext. Restore `SELVA_AT_REST_KEY`, or send a new key.

Apply this release's migrations: run `npx selva-supabase`, then `npx supabase db push`. Local deployments with a hand-written, non-UUID server id have to give it a UUID before they can save compute config.
