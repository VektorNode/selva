---
'@selvajs/server': minor
'@selvajs/selva': patch
---

Accepting an invite claims it before granting anything, so an invite revoked while the account is being created no longer grants its permissions or membership. The OpenAPI document now describes the request bodies of PATCH `/definitions/{guid}`, POST `/publish` and POST `/share-links`; `@selvajs/server/api` exports them as `UpdateDefinitionBodySchema`, `PublishVersionBodySchema` and `CreateShareLinkBodySchema`.
