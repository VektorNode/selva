---
'@selvajs/selva': patch
---

A definition cover the caller can't view answers 404, not 403, so the file route no longer confirms that another tenant's definition exists.

Header-auth: a sign-in now claims its allowlist row for its UPN (`claimedByUpn` in `header-allowlist.json`), and the email-header fallback admits only that UPN. Before, the fallback matched any row whose UPN was the forwarded address, so a proxy that didn't strip the email header let an unlisted user sign in as anyone, admins included. A UPN equal to the row's own `upn` always gets in and takes the claim over, so a UPN cleanup onto allowlisted addresses needs no edit. Rows from earlier versions are claimed on their next sign-in. If a user's UPN changes to anything else, set `upn` on their row to the new one. A duplicated email header is now ignored and logged, like a duplicated UPN. If the allowlist file is not writable, sign-in still works and a warning is logged; rows then stay unclaimed.
