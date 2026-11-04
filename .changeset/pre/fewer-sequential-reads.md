---
'@selvajs/platform': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/server': minor
'@selvajs/selva': patch
---

Fewer sequential round trips per request, and helpers so a host gets them too.

- `@selvajs/platform`: `IDefinitionStore.getDefinitionsFor` reads several definitions in one query, and `listVersionsFor` reads every version of several definitions in one query, newest first and without the schema. A page listing many definitions no longer issues one `get` or `listVersions` per definition. Both providers implement them, and the conformance suite covers them.
- `@selvajs/server/http`: `createSessionResolver` turns a session token into a host's session. It reads the user's rows while the token is checked, shares one resolution between requests carrying the same token, and with `freshForMs` reuses a session, re-checking it behind the request once the window has passed. A session is never answered past its token's expiry. `createRequestMemo` shares repeated reads within one GET or HEAD request.
- `@selvajs/server/http`: `resolveApiToken` takes a `resolutionCache` (`createApiTokenResolutionCache`, 60 seconds by default). A key seen within the window is answered without reading it or its owner again, and its delegated session is still minted fresh. Pass the same cache as `SelvaDeps.tokens.resolutionCache`: the revoke handlers, a member's removal and `revokeUserApiTokens` then drop the key from it at once. Another instance stops accepting a revoked key within the window.
- `@selvajs/server/compute`: `createServerResolver` remembers each caller's resolved compute server for 30 seconds. `SelvaDeps.onComputeConfigSaved` runs after the org compute handler saves, so a host clears it there.
- `@selvajs/selva`: a solve reads its definition's version and resolves its compute server while access is checked. The team, members, user-admin and token pages read in parallel. The solve page reads the org logo beside the definition. The session hook reads a JWT session's rows beside its check and shares one resolution between concurrent requests. API keys and compute server choices use the caches above. The hook no longer loads the MCP server at boot.
