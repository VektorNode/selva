---
'@selvajs/cli': patch
---

Rename the bootstrap bin from `create` to `cli` so `npx @selvajs/cli <dir>` resolves without needing `-p`. Previously the package shipped two bins (`create` + `selva`) and neither matched the unscoped package name, so npx failed with "could not determine executable to run" unless invoked as `npx -p @selvajs/cli create`. The `selva` operator bin is unchanged.
