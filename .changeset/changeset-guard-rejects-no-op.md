---
---

CI rejects a changeset naming only packages in the changeset `ignore` list. These bump nothing, so
`changeset version` writes no diff and the release job fails with "No commits between main and
changeset-release/main" — long after the PR that introduced it.
