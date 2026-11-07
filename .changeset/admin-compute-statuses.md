---
'@selvajs/server': minor
'@selvajs/selva': patch
---

`/api/admin/compute` answers with the status its checks raise instead of a 500: 409 when a save would move a server to a new URL without its key re-entered, or would overwrite a key that can't be decrypted; 400 for an invalid server; 403 without `manage_compute`. `/api/admin/compute/actions` and `/api/admin/compute/status` answer 403 instead of 500 without `manage_compute` too. `@selvajs/server/compute` gains `mergeApiKeys`, the whole apiKey merge for one scope's write, which the admin route and `/api/v1/orgs/{orgId}/compute` now share.
