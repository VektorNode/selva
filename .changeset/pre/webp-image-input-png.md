---
'@selvajs/ui': patch
---

File inputs: a WebP picked or fetched for an input that also accepts PNG is sent as PNG. A fetched file counts as WebP by its content, so a URL with no extension or another one still converts. Grasshopper's PDF export can't read WebP; PNG keeps the transparency.
