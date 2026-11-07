---
'@selvajs/platform': patch
---

The image transcoder refuses inputs that held a transcode slot for minutes: SVGs using filters, masks, markers, nested `<use>`, `stroke-dasharray`, embedded `data:` URLs or entity declarations, SVGs over 1 MB or 10,000 elements, and rasters wider or taller than 16,384 pixels. Content that starts like SVG is refused unparsed unless SVG was declared. The waiting queue is bounded (8 waiters, 20 s each) and answers 503 when full. Content types match case-insensitively.
