---
'@selvajs/local-provider': minor
---

No more lost writes, full erasure, and API token storage.

- Every store's read-modify-write runs alone through `withFileLock`, so concurrent saves can't drop an invite, grant, share link or compute server, and a revoked one can't come back. A share link's `maxSolves` holds under concurrent solves.
- Cached stores share `CachedJsonFile`: a failed write isn't served from memory, a file that failed to parse recovers once repaired, and the newest state wins.
- On Windows, a write that replaces a file someone is reading retries briefly instead of failing with `EPERM`.
- `LocalStorageProvider.put` writes through a temp file and returns the stored path. It refuses `.json` files in the storage root, which holds `auth-users.json`.
- `onUserDeleted` removes the user's invites, memberships, grants, share links and API tokens; orgs, projects, definitions and versions stay under `ERASED_ACTOR_ID`. `deleteOrg` soft-deletes the org's definitions.
- New `LocalApiTokenStore`, with serialized writes, wired into org delete and user erasure.
- The compute store refuses a server id another org or the platform already uses (409), binds each stored key to its server id (`enc:v2:`), and rewrites `enc:v1:` keys on the next save.
- Batch reads `getDefinitionsFor` and `listVersionsFor`.
- `/config` exports this provider's env slice.
