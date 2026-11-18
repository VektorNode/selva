---
'@selvajs/notifications': patch
'@selvajs/server': patch
---

Invite and API-token mails name the host's product (`deps.instanceName`) instead of "Selva", and a host can replace their wording per kind with `depsFromConfig(..., { mailTemplates: { invite, apiTokenCreated } })`. `renderUrlFallback` takes an optional label. Defaults are unchanged.
