---
'@selvajs/selva': patch
---

Fix premature "back online" verdict after an admin update. The update poller declared the app online as soon as `/api/health` reported a fresh `instanceId`, but that lightweight endpoint answers a beat before the app can serve real routes through the proxy — so an immediate health-check click could race a 502. The poller now additionally requires the heavier `/admin/api/system/health` route to answer 200 before reporting "back online" (gated on HTTP reachability, not its verdict, so a degraded-but-up instance still counts as online).
