# Diagrams

Docs are dark-only. Two kinds, one look:

- **Flows and sequences:** a ` ```mermaid ` fence. Already themed in `packages/website/svelte.config.js`; don't set colors per diagram.
- **Anything mermaid can't draw** (trees, layouts): a hand-written SVG in `packages/website/static/diagrams/`, embedded with `![alt](/diagrams/name.svg)`. Reference: `data-tree.svg`.

## Palette

| Role                             | Hex       | Contrast on `#16201a`  |
| -------------------------------- | --------- | ---------------------- |
| Background (rect, rx 12)         | `#16201a` |                        |
| Node fill                        | `#1e2a22` |                        |
| Lines, borders, neutral marks    | `#6f8073` | 4.0 (3.6 on node fill) |
| Text                             | `#e8ebe3` | 13.9                   |
| Muted text, column labels        | `#9aa79c` | 6.7                    |
| Accent (the one thing to follow) | `#7cc47f` | 8.0                    |

Lines and marks need 3:1 against what they sit on (WCAG 1.4.11), text 4.5:1. The old `#3a473d` border fails both at 1.7. Don't use it.

## Rules

- **One accent per diagram.** Green marks the thing the text is about. Everything else is neutral.
- **Color never carries meaning alone.** Pair the accent with a thicker stroke (3 vs 2) or a label.
- **Rendered size.** Diagrams fill the column (about 830px on desktop). Draw about 700 wide so type lands near 16px there.
- **Size for phones.** At 700 wide a phone shrinks it to about 0.5x, so type is 13px for labels and 15px for nodes and captions (about 7px on a phone). If it must stay readable there, draw it narrower and simpler.
- **Type.** Sans-serif for words, monospace for paths and code. Column labels uppercase, 14px, weight 600.
- **Shapes.** Nodes `rx 8`, strokes 2px, dashed (`5 4`) for pure grouping nodes, round line joins. Dots r 9.
- **Always** `role="img"` with `<title>` and a `<desc>` that says what the picture shows in words, including the highlighted path. The markdown alt text is the short version.
- No external fonts, scripts or images inside the SVG.
