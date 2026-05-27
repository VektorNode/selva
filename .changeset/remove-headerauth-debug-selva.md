---
'@selvajs/selva': patch
---

Remove the temporary forward-auth debug instrumentation from the login flow now that header-auth deployments have stabilized.

Removed the `/login` miss header dump in the SvelteKit hook layer and the original debug `Debug: request headers` block. The login page now distinguishes "proxy forwarded no identity headers" from "headers arrived but the user isn't allowlisted", and shows a redacted request-header snapshot in both forward-auth failure cases as a stabilization aid.
