---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
'@selvajs/selva': patch
---

An invite whose permissions or membership could not be applied after it was claimed is handed back, so the invitee can open the link again instead of needing a new invite. `IInviteStore` gains an optional `reopen`, implemented by the local and Supabase stores; the conformance suite tests it under the `reopen` option.
