---
'@selvajs/mcp': minor
---

`onToolCall` classifies an `ApiCallError` found through `cause`, so a tool that rewrites the error text with `throw new Error(text, { cause: err })` still reports `timeout` and the call's code. `ToolCallRecord` gains `status`, the failing call's HTTP status.
