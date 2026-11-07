---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
---

Compute API keys are sealed in a new `enc:v3:` envelope that binds both the server id and its URL, so a row whose `serverUrl` is edited at rest no longer decrypts and sends its key to the new host. Both compute-server stores seal and re-seal on save, `reencryptSecrets` moves `enc:v1:`/`enc:v2:` rows to v3, and `verifySecrets` reports them in `legacyEnvelopes`. v1 and v2 still decrypt. Decryption also pins a 16-byte GCM tag. `encryptSecret`, `decryptSecret` and `decryptWithKeys` accept a `{ id, url }` binding alongside the old string; new exports on `./computeServer`: `readAtRestKeys`, `parseKey32`, `isLegacyEnvelope`, `SecretBinding`.
