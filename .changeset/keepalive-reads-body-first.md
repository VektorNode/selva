---
'@selvajs/selva': patch
---

A solve behind Caddy no longer fails at random with "The connection dropped while waiting for the result". `/api/v1/compute` sent its keep-alive 200 before reading the request, and Caddy stops forwarding a request body once the response starts, so a request still in flight arrived cut off. The request is now read first. A host calling `respondWithKeepalive` must do the same.
