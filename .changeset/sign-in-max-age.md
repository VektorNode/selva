---
'@selvajs/server': minor
'@selvajs/selva': minor
---

`API_TOKEN_SIGN_IN_WINDOW_DAYS` retires API tokens whose owner stops signing in. Behind a header-auth proxy, a token gets 401 once its owner hasn't come through the proxy for that many days, so someone disabled at the identity provider loses their tokens too. Off unless set. `resolveApiToken` takes it as `signInWindowMs`, and `resolveApiTokenSignInWindowMs` reads it from the env.
