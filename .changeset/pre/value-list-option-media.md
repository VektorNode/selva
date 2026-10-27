---
'@selvajs/schemas': minor
'@selvajs/ui': minor
'@selvajs/compute': patch
---

Schema 2.17.0: value lists gain `segmented` and `tiles` display modes and an optional `optionMedia` map that gives an option an icon or a thumbnail. The icons and thumbnails live in a new root `assets` table, keyed by a hash of their content, so the `.gh` carries each one once. Icons are stored as SVG path data and thumbnails as small WebP, JPEG or PNG data URIs. Each option shows one picture, its thumbnail or else its icon, in every display mode. A button row with more than six options shows as a dropdown. The plugin marks a schema that has assets as needing plugin 0.24.0, so an older plugin refuses it instead of saving it without them. `normalizeUISchemaCasing` keeps option names in `optionMedia` and asset ids as they are.
