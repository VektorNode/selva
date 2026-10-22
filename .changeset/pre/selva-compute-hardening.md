---
'@selvajs/selva': patch
---

Hardening from `@selvajs/compute` and `@selvajs/solve`, for a running instance:

- One user can no longer choose what another user's solve returns. The shared solve cache keyed inputs by a 32-bit hash, which a crafted input could collide with in milliseconds.
- The Rhino.Compute API key no longer follows a redirect from the compute server. A server URL that redirects now fails with a message naming the address to configure instead.
- A compute response past `COMPUTE_RESPONSE_MAX_BYTES` is cut off mid-download instead of being held in memory in full first.
