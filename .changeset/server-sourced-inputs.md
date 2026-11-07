---
'@selvajs/solve': minor
'@selvajs/selva': patch
'@selvajs/schemas': patch
'@selvajs/platform': patch
---

An input whose `source.kind` is `server` solves with its schema default, and a solve that posts a value for it is refused with 400. No binding resolver is wired, so before this such an input took whatever a caller posted. The client no longer sends a value for these inputs. New on `@selvajs/solve/server`: `postedServerSourcedIds`; `SolveInput` gains `serverSourced`.
