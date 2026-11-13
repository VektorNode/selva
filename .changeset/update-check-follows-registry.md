---
'@selvajs/selva': patch
'@selvajs/cli': patch
---

The admin update check asks the registry in `NPM_CONFIG_REGISTRY` when it is set. It always asked registry.npmjs.org, while the install went through npm and so through a configured mirror: behind a private registry the page could offer a version the install would not fetch.
