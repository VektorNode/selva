---
'@selvajs/selva': patch
---

Admin dashboard: show the installed `@selvajs/selva` version instead of the Selva repo's git commit.

The General admin page had a "Web app build" card populated from build-time `__GIT_*__` constants — i.e. the last commit of the Selva monorepo when the package was published, not anything the operator controls. On an npm deployment that showed confusing values like "Merge pull request #82…". Replaced it with an "Installed version" card sourced from the deployment's own `@selvajs/selva` package version, and removed the now-dead git-info plumbing (vite `define`, `app.d.ts` globals, eslint globals).
