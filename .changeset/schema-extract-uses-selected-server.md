---
'@selvajs/selva': patch
---

Fix: extract a definition's schema on the compute server the upload selects, not the org/global default.

`POST /api/compute/schema` resolved a server without a definition pin, so the pre-upload schema preview always ran on the org default → global default. If the upload dialog selected a non-default server, the schema was extracted on a different server than the one that later solves the definition — masking server-specific differences (e.g. block-instance support in the VektorNode Compute fork). The endpoint now accepts a `computeServerId` query param and threads it as the resolution pin, mirroring `POST /api/definitions`. The Add Definition dialog sends the selected server and re-validates when that selection changes.
