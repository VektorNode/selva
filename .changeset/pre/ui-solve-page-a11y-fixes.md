---
'@selvajs/ui': minor
---

Fixes on the `ComputeApp` solve page:

- New `primaryAction` prop on `ComputeApp` and `AppLayout` (an `ActionButton`): a visible button beside Calculate for the host's main commit action, instead of a second entry in the ⋯ menu. Absent, nothing changes.
- A failed solve no longer replaces the layout. Its message joins the footer's messages like a definition's own errors, and the inputs stay editable so the user can change them and solve again.
- An image output with no data, as after a failed solve, shows the no-result placeholder instead of "Couldn't decode". An image that failed to decode no longer stays failed when the next solve brings a good one.
- A field's help button is named by the new `helpFor` message ("Help for {label}") rather than the bare label.
- A dropdown field's label now names its combobox trigger.
- The resizable panel handles carry `aria-valuenow`, `aria-valuemin` and `aria-valuemax` from first render.
