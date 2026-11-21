---
'@selvajs/solve': minor
'@selvajs/selva': patch
---

`createComputeFetchSolveFn` takes `inputs` as optional and leaves it out of the request body when it is not given. A stored (`local:`) definition's server reads its own inputs, so only a remote `definitionUrl` needs them. The library page and the MCP `selva_solve` tool no longer send their whole input schema with every solve.
