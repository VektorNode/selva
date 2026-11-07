---
'@selvajs/server': patch
'@selvajs/selva': patch
---

`GET /api/v1/orgs/{orgId}/invites` refuses an API key with 403, as creating and resending invites already did: the list holds invitee email addresses. Revoking an invite and changing org branding still work with a key, since neither grants access.
