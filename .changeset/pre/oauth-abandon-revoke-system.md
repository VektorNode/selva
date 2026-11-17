---
'@selvajs/server': patch
'@selvajs/selva': patch
---

`revokeUnredeemedConsentToken` reads the consent key as system. It runs after the code's lifetime, when the consenting session's JWT may have expired, so on Supabase the RLS read failed and the abandoned key stayed live. A failed revoke is now logged instead of swallowed.
