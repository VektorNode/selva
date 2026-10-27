---
'@selvajs/selva': minor
'@selvajs/ui': patch
'@selvajs/server': minor
---

Built on SvelteKit 3.

- `@selvajs/selva`: nothing changes for a running deployment; `.env`, the start command and the proxy setup stay as they are. adapter-node 6 no longer reads `ORIGIN`, so Selva applies it itself: links, OAuth metadata and the form-CSRF check use `ORIGIN` when it is set, as before.
- `@selvajs/server`: `isCrossSiteFormSubmission` takes an `origin` option for hosts that know their public origin better than `request.url` does.
- `@selvajs/ui`: packaged with `@sveltejs/package` 3. The published output is unchanged and still supports SvelteKit 2 and 3.
