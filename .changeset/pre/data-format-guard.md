---
'@selvajs/selva': minor
'@selvajs/cli': minor
---

The updater refuses a release that cannot read the deployment's data, before it stops the app. Each release declares a data format (`selva.dataFormat` in `package.json`; 4.21.0 is format 2, releases without the field are format 1), and a target on a lower format than the installed one is refused with exit code 10. The System page shows the block instead of the Update button. Before, switching from a 4.21.0 beta back to 4.20.0 left stored Compute API keys unreadable. [Going back to an older release](https://github.com/VektorNode/selva/blob/main/docs/self-hosting/deployment/admin.md#going-back-to-an-older-release) has the manual steps.

A boot whose database schema handshake fails no longer re-seals Compute API keys. The updater rolls that boot back to the previous version, which could not read keys already re-sealed.
