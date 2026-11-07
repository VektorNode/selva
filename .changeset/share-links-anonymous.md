---
'@selvajs/solve': minor
'@selvajs/selva': patch
---

Share links work without an account. The app's session gate let no anonymous request reach the two routes that accept a share token, so a link opened by someone signed out went to the login page, and its solves were refused. The gate now lets a request carrying a share token through to those two routes, which accept or refuse the token themselves. The login redirect no longer copies a share token into `redirectTo`.

`createComputeFetchSolveFn` takes a `bearerToken` option, sent as `Authorization: Bearer …`. The library page passes its share token there, in a header rather than the URL, so it stays out of access logs.
