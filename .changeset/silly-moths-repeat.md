---
'@selvajs/selva': patch
---

Fix the display name typed at invite signup being silently discarded.

`updateProfile` patches an existing data-layer row and reports `not_found` for a missing one. A new invitee has no row yet — `ensureUser` seeds it on the first authed request, which has not happened at signup — so the name was dropped and the UI fell back to the email's local part. Seed the row first, and log a non-`ok` result instead of swallowing it.
