---
'@selvajs/header-auth-provider': patch
---

Header-auth's email fallback matches only an allowlisted UPN, never the email column the proxy writes, so a reassigned address can't land on a departed person's row; a renamed UPN is allowlisted again.
