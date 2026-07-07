---
'@selvajs/selva': patch
---

Surface session expiry as a clear, actionable error instead of a silent failure. Sessions are capped at 8 hours, so a compute page left open outlives its `admin_session` cookie — the next solve POST then went out unauthenticated and failed with an empty response and a bare "Compute error" (or a raw `SyntaxError` when a proxy replaced the body). The API 401 from the auth hook now says "Your session has expired. Sign in again to continue.", which every fetch call site that displays the response message picks up. The compute solve path additionally detects expiry without relying on the response body (an SSO proxy such as Azure App Proxy can strip it): a 401 or a redirect to `/login` tells the user to sign in again in a new tab and re-run — preserving their input state on the page — the generic fallback now names the HTTP status, and a non-JSON body on a 200 reports an invalid server response instead of the parse exception.
