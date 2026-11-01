---
'@selvajs/local-provider': minor
'@selvajs/platform': patch
---

The local provider no longer loses writes, and erasure now reaches everything on disk.

- Every store's read-modify-write runs alone through `withFileLock`, so concurrent saves can't drop an invite, a grant, a share link or another org's compute servers, and a revoked invite or grant can't come back. A share link's `maxSolves` holds under concurrent solves.
- The cached stores share `CachedJsonFile`: a failed write is no longer served from memory, a file that failed to parse recovers once repaired, and the newest state wins overlapping writes.
- `LocalStorageProvider.put` writes through a temp file, so a concurrent `get` can't come back short. It refuses `.json` files in the storage root, which is `DATA_PATH` and holds `auth-users.json`.
- `deleteOrg` soft-deletes the org's definitions, and `IOrgStore.deleteOrg`'s doc now lists what cascades.
- `onUserDeleted` removes invites to or from the user, their membership rows, user grants and the share links they minted. Orgs, projects, definitions and versions stay, under `ERASED_ACTOR_ID`.
