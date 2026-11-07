---
'@selvajs/cli': patch
---

The CLI writes `.env` to a new owner-only file and renames it into place, so its keys are never readable through an existing world-readable `.env`; `selva config set|unset`, `selva migrate` and `selva doctor` write their `.env` backups the same way. A symlinked `.env` keeps its link, and a run as root keeps the file's owner.
