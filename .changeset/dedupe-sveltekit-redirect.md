---
'@selvajs/selva': patch
---

Fix `redirect()` (and other SvelteKit control-flow throws) surfacing as an "[Unhandled error]" 500 instead of redirecting. The monorepo resolved `@sveltejs/kit` against two Vite majors, splitting it into multiple module instances and breaking SvelteKit's `instanceof Redirect`/`HttpError` checks. The shared Vite config now dedupes `@sveltejs/kit`, `svelte`, and `vite` to a single physical copy.
