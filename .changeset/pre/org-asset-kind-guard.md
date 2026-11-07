---
'@selvajs/platform': patch
---

`orgPaths.asset` checks the asset kind again, so a kind that is not a safe key segment throws `Unsafe assetKind` instead of reaching the storage key.
