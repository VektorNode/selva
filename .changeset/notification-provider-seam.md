---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/selva': minor
---

Outbound mail moves behind an `INotificationProvider` seam

Selva had two mail systems that did not know about each other: GoTrue owned magic
links, and `$lib/server/email/` owned invites — one renderer wired straight to
nodemailer, living inside the app. Neither is wrong alone, but the next message
(a failed solve, a shared project) had nowhere to go except a third path, and
then every mail Selva sends looks different and obeys different rules.

`@selvajs/platform/notifications` adds the transport interface —
`INotificationProvider`, `OutboundMessage`, `SendResult`, `NotificationKind`, and
a `NoopNotificationProvider` for instances that send nothing. `send` must not
throw: by the time it runs the invite row is already committed and the caller
still holds the accept URL, so a dead SMTP host must not turn a successful write
into a failed request. `not-configured` stays distinct from `failed` because an
instance with no mail server is a supported deployment, not a broken one.

`@selvajs/server/notifications` adds `SmtpNotificationProvider`, a lift of the
app's old mailer with nodemailer as an optional peer. `readSmtpConfig` now takes
an env bag rather than importing SvelteKit's `$env/dynamic/private` — the
provider lives outside the app, and under `vite dev` Vite does not mirror `.env`
into `process.env`, so a provider reading it directly would ignore every
override.

Templates move to a new private `@selvajs/notifications`, where they are pure
render with no I/O, no env and no transport. One shared layout wrapper and one
`escapeHtml` replace the per-file copies.

No behaviour change: same mail, same SMTP settings, same fallback to sharing an
invite link by hand when mail is off.
