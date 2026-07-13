---
'@selvajs/compute': minor
---

Export `LOOKS`, the render-look values as a runtime array, so consumers can build a style picker without hardcoding the names.

- `LOOKS = ['technical', 'studio', 'showcase'] as const` is the single source of truth; the `Look` type is now derived from it (`(typeof LOOKS)[number]`), so the type and the enumerable list can never drift.
- Exported as a value from both `@selvajs/compute/visualization` and the internal visualization barrel; `Look` is now also re-exported from `@selvajs/compute/visualization`. Adding or renaming a look updates every consumer's iteration automatically.
