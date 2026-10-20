---
'@selvajs/ui': patch
---

An image or chart output without data no longer draws an empty "waiting" box: it stays hidden until a solve returns its data, and a group, tab or side pane holding nothing else closes with it, so an unsolved preview no longer takes a third of the screen. While a returned image is still decoding, its frame shows a loading indicator. A dynamic value list output, which never draws, no longer leaves an empty cell in its group.
