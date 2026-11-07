---
'@selvajs/server': patch
---

The console logger used when `pino` isn't installed now redacts credential fields (`apiKey`, `authorization`, `password` and the rest of the list) the way the pino logger does. Both now redact every listed name one level deep, `api_key` and `cookie` included.
