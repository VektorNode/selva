---
'@selvajs/local-provider': patch
'@selvajs/platform': patch
---

The local compute store refuses a server id that another org or the platform already uses, with a 409, as Supabase does. Keys are looked up by id alone, so an org admin who knew another tenant's server id could have had that tenant's Rhino.Compute key sent to their own URL. The compute store conformance suite now checks both providers for this.
