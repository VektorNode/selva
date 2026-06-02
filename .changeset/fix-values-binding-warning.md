---
'@selvajs/ui': patch
---

Fix dev-mode binding warning by removing the redundant two-way binding on `values` in `AppLayout` and `TabLayout`. The `values` object is a `$state` proxy that is only ever mutated in place, so `bind:`/`$bindable()` was unnecessary and produced a "did not declare values as a binding" warning through the `AppShell` → `AppLayout` prop chain.
