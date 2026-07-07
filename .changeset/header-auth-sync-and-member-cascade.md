---
'@selvajs/selva': patch
---

Two data-hygiene fixes for user lists. Header-auth now mirrors email and display name from the proxy headers on every visit instead of writing them once — an IdP rename, or a corrected proxy config that used to forward the wrong claim (e.g. the OIDC `sub` as the display name), heals the stored allowlist row on the user's next login. Deleting a user now also soft-deletes their org memberships in the local data provider (Supabase already gets this via FK cascade), so the team roster no longer accumulates orphaned rows that render as bare user IDs.
