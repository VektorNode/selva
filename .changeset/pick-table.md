---
'@selvajs/ui': minor
---

A `dynamicValueList` payload can carry a pick table (`pickTable`: `by`, `inputs`, `parents`, `rows`): the valid combinations for inputs that depend on each other. `buildFormModel` gives each input the values its column still has in the rows matching the picks it depends on, and resolves its pick against those, as Grasshopper does in the solve. Picking one input narrows the inputs that depend on it without a solve. `by` names inputs that narrow the rows without being filled, `parents` which input each one narrows on, and an input that is also a repeat member narrows once per row. New export: `PickTable`. Needs a Selva plugin with Options Table; older plugins never send the field.
