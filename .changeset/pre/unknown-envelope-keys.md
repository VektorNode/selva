---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
'@selvajs/server': patch
'@selvajs/selva': patch
'@selvajs/cli': patch
---

A Compute API key sealed by a newer Selva than the one running is no longer reported as plaintext. Both compute-server stores return the server without a key and log what happened, `verifySecrets` reports the new reason `unknown_envelope`, and system health and `selva update` name the downgrade. `@selvajs/platform/computeServer` gains `isUnknownEnvelope`.

`/admin/compute` can replace a key the local store cannot read. Reading keys for a save used to throw on a plaintext key, so the save that the error message asked for failed with a 500. Reads that use the key still throw on plaintext.

The CLI help and docs say that `npx selva` outside a deployment directory resolves to an unrelated npm package.
