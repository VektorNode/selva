---
'@selvajs/ui': patch
---

Make the viewer's branding logo watermark larger so it stays legible.

The watermark was capped at `h-8`/`max-w-32` (`sm:h-10`), which rendered wide wordmark logos too small to read. It now scales to `h-10`/`max-w-40`, and `sm:h-14`/`sm:max-w-56` on larger viewports.
