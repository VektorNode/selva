---
'@selvajs/server': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': minor
---

Upload-only API tokens and the Grasshopper plugin's sign-in.

- A key whose scopes only read and upload may be held by anyone who can create a definition in one project of the token's org; anything broader still needs `manage_api_tokens`. Checked at mint and on every request.
- **Breaking:** `ApiTokenHolderPolicy` is `(ctx, scopes) => boolean | Promise<boolean>`, and `canHoldApiTokens(ctx, scopes, { policy, deps })` is async. `ResolveApiTokenDeps.data` also needs `projects`, `platformProjectGrants` and `definitions`, plus an optional `flag`.
- OAuth knows a built-in client, `selva-grasshopper`, which redirects only to `http://127.0.0.1/callback` on any port and is the only client that may be granted the new `upload` scope. Registered clients asking for it get read and solve at most. `consentChoices`, `consentOrgs` and `mintConsentToken` let a consent page mint in an org the user picks, through `mintApiToken`, the same core as the token endpoint.
- `revokeOwnApiToken` lets a key revoke itself; `runHandler`'s `anyScope` opens a route to every key.
- `GET /projects` items gain `canCreateDefinitions`, `GET /definitions/{guid}` gains `canEdit` and `sourceDocumentId`, list items gain `sourceDocumentId`, and `GET /definitions?documentId=` finds the definitions from one Grasshopper document the caller can upload to. `/me` reports the key's `expiresAt`.
- Supabase: migration `20261021120000_selva_definition_source_document` adds `definitions.source_document_id`.
