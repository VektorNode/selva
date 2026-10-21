---
'@selvajs/platform': minor
'@selvajs/mcp': patch
---

API tokens have a fourth action, `upload`: creating definitions, uploading versions, making a version live and previewing a file's schema, and nothing else. `upload` includes `read`, and `write` includes `upload`; `apiScopeActionCovers` says which action covers which. `canCreateDefinition` is the rule for adding a definition to a project. Definitions carry `sourceDocumentId`, the Grasshopper document GUID of the last upload that had one, and `DefinitionListOptions.sourceDocumentId` filters by it in the store query.

**Breaking:** `narrowApiTokenContext` takes the token's `expiresAt`, and `ctx.apiScope` carries it.
