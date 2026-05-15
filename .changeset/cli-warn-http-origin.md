---
'@selvajs/cli': patch
---

Warn during `selva` / `create` scaffolding when the user enters an `http://` ORIGIN. Plain HTTP origins are a silent footgun: session cookies are minted with `Secure` under `NODE_ENV=production`, so browsers drop them and login appears to succeed but every subsequent request is anonymous. The prompt now prints a yellow note pointing operators at the two fixes (put TLS in front, or set `ALLOW_INSECURE_COOKIES=true` for testing).
