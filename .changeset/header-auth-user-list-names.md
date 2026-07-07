---
'@selvajs/selva': patch
---

Show real names instead of raw user IDs for header-auth users in the admin and team user lists. Allowlisted users who have not signed in yet have no materialized email, so every list fell back to their UUID; the auth provider now exposes the allowlisted UPN (the address the admin typed) as the email until the real one arrives from the proxy headers on first login, and both lists now surface the IdP display name (`SELVA-DisplayName`) when the user has not set a profile name. Also fixes the admin users page doing a `getOrgMember` round-trip per user on every load — memberships are now fetched as one listing (drained across pages, so orgs beyond 200 members no longer render users as permissionless, which the permission-toggle UI could have turned into an accidental permission wipe).
