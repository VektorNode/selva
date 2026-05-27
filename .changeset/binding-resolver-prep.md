---
'@selvajs/platform': minor
---

Add a server-side binding resolver for schema inputs marked `source.kind === 'bound'`.

New `IBindingResolver` interface and `NoopBindingResolver` default, exposed via the new optional `SelvaConfig.bindingResolver`. The resolver batches opaque, host-defined paths to values at solve time; the default returns nothing so any bound input fails loudly (matching the schema's `onMissing: 'fail'` default) until a host wires a real implementation.
