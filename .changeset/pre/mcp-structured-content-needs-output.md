---
'@selvajs/mcp': minor
---

A tool without `output` no longer sends `structuredContent`. Clients showed that JSON in place of the text and dropped its hints; a tool that wants structured results declares `output`, which lists it as `outputSchema`.
