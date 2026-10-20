---
'@selvajs/ui': minor
---

The panel footer is Calculate plus one ⋯ menu. Saving and loading inputs, and every `panelActions` entry, are items in that menu instead of a row of buttons; on a phone the menu sits in the drawer's pinned footer, so saving and loading are reachable there too.

- `PresetLabels`: `saveButton` and `loadButton` become `saveMenuItem` and `loadMenuItem` ("Save inputs…", "Load inputs…"); the save dialog's confirm button reads the new `saveConfirmButton`. Dialog copy says "inputs" instead of "parameter state".
- `ActionButton`: `size` is gone and `variant` is `'default' | 'destructive'`; `hint` shows under the item's label.
- `CalculateButton` takes a `trailing` snippet, drawn beside the button in its row.
- New message `moreActions` names the menu.
