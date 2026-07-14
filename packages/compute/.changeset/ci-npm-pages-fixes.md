---
'@selvajs/compute': patch
---

CI-only fixes, no package behavior change: pinned the release workflow's npm upgrade to the 11.x line (npm 12 dropped Node 20 support, breaking OIDC trusted publishing on our runner), and added a `concurrency` guard to the docs deployment workflow to prevent overlapping runs from producing duplicate `github-pages` artifacts.
