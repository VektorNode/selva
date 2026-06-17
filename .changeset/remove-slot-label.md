---
'@selvajs/schemas': minor
'@selvajs/ui': minor
---

Remove `slotLabel` from client-input slots.

The optional `source.client.slotLabel` field is dropped from the UI schema and from
`ClientSlotArgs`. A custom slot still reserves the input's cell and hands it to the
host's `clientSlot` snippet — the host now derives its own caption (from the input's
display name / its own knowledge of the producer) instead of an author-set label.

Non-breaking for existing data: stored schemas that still carry `slotLabel` are
ignored everywhere (the schema is type-generation only, not runtime-validated; the
Grasshopper plugin deserializes `source.client` as an opaque object). Hosts that
read `ClientSlotArgs.slotLabel` should drop that reference.
