---
'@selvajs/ui': patch
---

Stronger contrast for control boundaries, focus and error text in `base.css`. `--input` is `oklch(0.62 0 0)` in light mode (was `oklch(0.91 0 0)`, about 1.3:1) and `oklch(1 0 0 / 36%)` in dark mode (was 12%), at least 3:1 against background, card and muted, so field borders and unchecked boxes stay visible. `--ring` and `--sidebar-ring` are `oklch(0.55 0 0)` in light mode (was 0.67), and every primitive now draws its focus ring at full opacity instead of 50%, so the ring reaches 3:1 too; destructive buttons and badges use the same ring as the rest. Light `--destructive` is `oklch(0.55 0.19 27)` (was `oklch(0.6 0.18 27)`), so error text reaches 4.5:1.
