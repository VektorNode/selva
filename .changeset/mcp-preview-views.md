---
'@selvajs/mcp': minor
'@selvajs/selva': minor
---

Previews cost less compute and show more:

- `selva_capture_preview` takes `views` (up to four) and returns a picture and preview id per view, all from one solve. It replaces `view`.
- `selva_solve` returns a solve id, held for an hour. `selva_capture_preview` with `solve` draws that result without solving again.
- `selva_capture_preview` takes a `look`, e.g. `night` to see a model's lamps, instead of always the definition's own.
- `captureSolve` takes `views` and resolves `pngs`, a PNG per view; `view` and `png` still work for one.
