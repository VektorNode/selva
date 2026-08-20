---
'@selvajs/selva': minor
---

Email invitations directly instead of copying the link by hand.

Set `SMTP_HOST`/`SMTP_FROM` (see `.env.example`) and creating an invite mails the accept link to the invitee. Sending is best-effort — with SMTP unconfigured, or if delivery fails, the link is still returned for manual sharing, and the members page says which happened.

Adds `POST /api/v1/orgs/{orgId}/invites/{id}/resend`, surfaced as a Resend button. Because the raw token is never stored, a resend mints a replacement and revokes the original: the previous link stops working.
