---
'@selvajs/ui': minor
---

`ActionButton` (the `panelActions` prop) takes `disabled?: boolean` and `hint?: string`. The hint is a short line under the button, linked to it with `aria-describedby`, so a host can show an action as unavailable with its reason instead of hiding it. In click-to-calculate mode the calculate button now sits above the panel actions, in the order they are used. On a phone the panel actions and the calculate button are pinned in the drawer's footer instead of following the last field.
