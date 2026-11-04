---
'@selvajs/server': minor
'@selvajs/selva': minor
'@selvajs/platform': minor
---

`SIGN_IN_MAX_AGE_DAYS`: how long one sign-in at the identity provider lasts, on every auth provider. Past it, an API token whose owner hasn't signed in again is revoked (reason `sign_in_lapsed`) and answered like an invalid key, minting answers 401 `SIGN_IN_REQUIRED`, the OAuth consent page sends the person to sign in again, and a browser session Selva manages can't be refreshed. Off unless set; a value that isn't a whole number stops the boot. `@selvajs/server/http` exports `resolveSignInMaxAgeMs` and `signInIsStale`; `createSessionRefresher` and `resolveApiToken` take `signInMaxAgeMs`.

Changing or removing an org member now needs a browser session, like invites and API tokens: an API key gets 403. Accepting an invite checks that the person who sent it is still enabled and in the org, or an instance admin (`inviterStillVouches`). `/login?reauth=1` ends the current session and asks the person to sign in again.

`AuthUser.lastLoginAt` is documented as the last real sign-in, never a session refresh, and the shared auth suite pins it with `signInContract`.
