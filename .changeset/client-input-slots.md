---
'@selvajs/schemas': minor
'@selvajs/ui': minor
---

Add an optional presentation mode for client-sourced inputs. An input with `source.kind === 'client'` can now set `source.client.presentation` to `'hidden'` (default, prefilled silently) or `'slot'`, where the host app renders its own element in the input's place via a new `clientSlot` snippet on `ComputeApp`. Selva reserves the cell and passes `{ inputId, displayName, slotLabel, value }` to the host snippet without interpreting it — e.g. an "Edit JSON" button that navigates back to a producer page. An optional author-set `slotLabel` is passed through untouched.
