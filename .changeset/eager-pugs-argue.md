---
'@selvajs/visualization': minor
'@selvajs/ui': patch
---

Fix the scene panel crashing with `each_key_duplicate` on scenes holding duplicate object identities

`SceneEntry.key` is a _visibility_ key, and it is deliberately not unique: an object with no
writer-minted id falls back to name + layer, so two identity-less meshes sharing both collide, and
that collision is what makes them hide together. The panel keyed its `{#each}` on it anyway, so any
scene containing such a pair took Svelte's `each_key_duplicate` error and the whole scene manager
failed to open — intermittently, since it depended on what the last solve happened to produce.

Entries now also carry `rowKey`: the same identity, with repeats suffixed (`key`, `key#1`, `key#2`)
so it is unique across one `getSceneEntries` call. The panel keys rows on that and still reads
`key` for hiding and selection, so colliding objects keep hiding together as before.
