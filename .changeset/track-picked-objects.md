---
'@selvajs/schemas': minor
---

Schema 2.18.0: an optional `localOptions.trackPickedObjects`. When it's on, geometry picked in the Rhino viewport follows the Rhino objects it came from: editing or moving one re-solves with its new shape, and deleting one drops it from the pick. Off, the default, a pick is a snapshot. Only the plugin's local preview reads it; Selva ignores it.
