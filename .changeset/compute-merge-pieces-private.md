---
'@selvajs/server': major
---

`@selvajs/server/compute` no longer exports `assertStoredKeysReadable`, `assertKeyNotRetargeted`, `resolveApiKey` or `storedKeysById`. A merge rebuilt from them could skip the retarget check and send a stored key to a new URL. Call `mergeApiKeys(incoming, scopedStored)` instead: it runs both checks and returns the key to store for each submitted id. A write that saves a scope's servers whole passes every server in the set, with `apiKey` omitted for the ones it doesn't change.
