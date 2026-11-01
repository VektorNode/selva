---
'@selvajs/compute': patch
'@selvajs/solve': patch
'@selvajs/visualization': patch
---

`dist` is no longer minified, so stack traces and `err.constructor.name` read as written. A consuming bundler still minifies it.
