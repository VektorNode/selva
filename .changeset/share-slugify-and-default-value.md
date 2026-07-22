---
'@selvajs/platform': minor
'@selvajs/schemas': minor
'@selvajs/ui': patch
'@selvajs/selva': patch
---

Export two utilities that had no publishable engine home, so downstream apps can share them instead of re-implementing them.

- `@selvajs/platform` now exports `slugify(name)` alongside `SlugSchema` (in `organizations/schemas.ts`, re-exported from the org and root barrels). It coerces an arbitrary name into the shape `SlugSchema` validates — lowercase, non-alphanumeric runs collapsed to single hyphens, edge hyphens trimmed, capped at 63 chars — but does not itself guarantee validity (an all-symbol name yields `''` and reserved words pass through), so callers must still run the result through `SlugSchema`. The Selva app's private `server/slug.ts` copy is deleted and its six importers repoint to the package.

- `@selvajs/schemas` now exports `getDefaultValue(paramType)` (the value an input carries when the schema supplies no explicit default), moved from `@selvajs/ui`'s `schema/defaults` so server-side callers can share it without pulling in the UI package. `@selvajs/ui/schema/defaults` keeps working as a thin re-export, so existing UI consumers are unaffected.
