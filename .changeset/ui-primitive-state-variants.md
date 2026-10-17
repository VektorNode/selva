---
'@selvajs/ui': patch
---

`DropdownMenu` and `Popover` content now animates open and closed, an open submenu's trigger stays highlighted, and a joined `ToggleGroup` rounds its outer corners and shares one border between items. These styles keyed on attributes bits-ui never sets; they now read its `data-state` and `data-orientation`.
