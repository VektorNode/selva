---
'@selvajs/server': minor
---

- New `@selvajs/server/oauth`: an OAuth 2.1 authorization server for MCP clients that issues ordinary API tokens. Clients register through DCR or Client ID Metadata Documents, with no storage; codes are sealed, single-use, PKCE-bound and last a minute.
- New `isCrossSiteFormSubmission` in `@selvajs/server/http`: the form-CSRF check, exempting requests that carry `Authorization` and a host's listed paths.
