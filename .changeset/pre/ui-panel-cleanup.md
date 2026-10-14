---
'@selvajs/ui': minor
---

Cleaner parameter panel for definitions with many inputs. Each group is one borderless card on a tinted panel background instead of a bordered card with a grey header, so inputs get more of the panel's width. Multi-column groups drop columns as the panel narrows instead of squeezing every field. Checkboxes sit on one row with their label. A slider is one box with its typed value on the left and the track on the right, at the same height as a number input, so mixed rows line up. Help icons show on hover. The min/max hint no longer shows on sliders, and on number boxes it appears beside the label only while the box has focus. The tab bar uses an underline style with scroll buttons when tabs overflow. `Tabs.List` and `Tabs.Trigger` take a `variant: 'default' | 'line'` prop.
