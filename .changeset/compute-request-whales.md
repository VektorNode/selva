---
'@selvajs/selva': patch
---

Name the inputs responsible for heavy solve requests: when the `values` payload exceeds 256 KB, the browser log lists the three largest inputs by name and size, so an embedded geometry/file value paying the slow uplink on every solve is identified directly. Also replace the opaque "Failed to fetch" on solve requests killed by an SSO proxy session expiry (302-to-IdP blocked by CORS) with an actionable "reload the page to sign in again" error.
