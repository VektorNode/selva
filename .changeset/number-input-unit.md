---
'@selvajs/schemas': minor
'@selvajs/ui': minor
---

UI schema 2.21.0: `NumberWidgetConfig` gains an optional `unit` (up to 16 characters, e.g. "mm"). The builder sets it per number input; `NumberInput` shows it after the value, inside the box or beside a slider's value, and screen readers hear it as the field's description. Display only: the solve still gets the bare number.
