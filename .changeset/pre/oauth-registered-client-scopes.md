---
'@selvajs/server': minor
'@selvajs/selva': patch
---

`createOAuthServer` takes `registeredClientScopes`, all a DCR or CIMD client can be granted, drawn from `REGISTERABLE_SCOPES` (`read`, `solve`, `write`) and defaulting to `['read', 'solve']`. It throws on a scope outside that list or a list without `read`. `OAUTH_SCOPES` gains `write`, mapped to `write:all`. `write:all` covers `upload` and `create_projects` at `/api/v1` and can delete projects and definitions, so enabling `write` hands a look-alike client both.

The server exposes `registeredScopes` for the MCP 401 challenge, and its discovery documents advertise only scopes some client can be granted. `consentChoices` offers `write` with and without `solve` (`write_and_solve`), and `consentOffer` looks up the acting org once for all levels.

Selva serves the discovery documents from its OAuth server, answering 503 when OAuth isn't configured. The consent page never preselects a level that can delete.
