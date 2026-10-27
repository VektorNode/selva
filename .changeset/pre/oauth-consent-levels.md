---
'@selvajs/server': minor
'@selvajs/selva': patch
---

- **Breaking:** `consentOffer` returns `{ levels: { choice, orgs }[] }`: each access level lists the orgs it may be granted in, so a narrower level can offer orgs the widest one can't.
- `revokeUnredeemedConsentToken` and the OAuth server's `onRedeemed` option let a host revoke a consent key whose code is never exchanged.
- `createHolderVerdictCache` lets `resolveApiToken` skip the holder check for a token that passed it recently. A withdrawn right then takes effect within the TTL (30s by default).
