# Notifications and outbound mail

## Why

Selva has two mail systems that do not know about each other.

- **GoTrue's mailer** owns magic links. `SupabaseAuthProvider.sendMagicLink` calls
  `signInWithOtp` and GoTrue mints the token, renders the template, and sends the
  mail. Selva passes `emailRedirectTo`, but GoTrue only honours a redirect that
  matches its allow-list and otherwise falls back to `SITE_URL` — which on a default
  project is `http://localhost:3000`. That is the sign-in bug: a Selva-side value
  silently discarded by a service Selva does not configure.
- **`$lib/server/email/`** owns invites. One `sendMail`, one renderer, hardcoded to
  nodemailer and to SvelteKit's `$env/dynamic/private`, living inside the app.

Neither is wrong on its own. The problem is what happens next: the moment we want
"your solve failed" or "someone shared a project with you", there is no place to put
it. Adding a third path is the default outcome, and then every mail Selva sends looks
different and obeys different rules.

The fix is that Selva owns every outbound message, and Supabase becomes a
token-minter only.

## Target shape

### 1. `INotificationProvider` in `@selvajs/platform`

A sibling to `IAuthProvider` / `IStorageProvider`, under `platform/src/notifications/`.
Transport only — it knows how to put a message on the wire and nothing about what is
in it.

```ts
interface INotificationProvider {
	readonly name: string;
	send(message: OutboundMessage): Promise<SendResult>;
}
```

`SmtpNotificationProvider` is the first implementation and is a near-lift of today's
`mailer.ts`. Later: Resend, or a webhook provider for Slack/Teams.

Keep `sendMail`'s never-throws contract and generalise it. That contract is already
right and the reason is written down in `mailer.ts`: the invite row is committed
before the mail goes out and the caller still holds `acceptUrl`, so a dead SMTP host
must not turn a successful write into a 500. Every future notification inherits the
same shape — a notification is never the thing the user asked for, so it must never
be the thing that fails their request.

### 2. `packages/notifications` — a template registry

Templates are pure: data in, `{ subject, text, html }` out. No I/O, no env, no
provider. Keyed by an event name:

```ts
type NotificationKind = 'org.invite' | 'auth.magic-link' | 'solve.failed' | 'project.shared';
```

`renderInviteEmail` moves in as the first entry and is the model for the rest: plain
markup, no images, no tracking pixel, no external stylesheet, and a text part that
still carries the link when the HTML is stripped.

Two things become shared rather than per-file:

- **The layout wrapper** — the card chrome currently inlined in `inviteEmail.ts`.
  Each template supplies a body; the wrapper supplies the frame. This is what makes
  every Selva mail look like Selva instead of like whoever wrote that template.
- **`escapeHtml`** — one copy. Per-template copies are how one of them ends up
  missing a case.

Templates take resolved values (`orgName`, not `orgId`). Resolution is the
dispatcher's job — a template that can fetch is a template that can fail.

### 3. `notify()` — the dispatch seam

This is the load-bearing piece. Templates render; `notify()` decides whether and
where.

```ts
await notify({ kind: 'solve.failed', to: userId, data: { ... } });
```

`to` is a **user id, not an address**. That indirection is the entire point. The
dispatcher resolves the address, checks the user's preferences for this kind, and
drops the message if they have opted out. It also owns the resolution the templates
are not allowed to do (org name, display name, branding).

Preferences must exist before there are many call sites, not after. Bolting them on
later means revisiting every caller, and the one that gets missed is the one that
mails someone who asked not to be mailed.

Per the logging rules in CLAUDE.md: log `kind`, `userId`, and outcome. Never the
rendered body, never the data payload. `mailer.ts` already logs the recipient at
warn/error only, which is the minimum to diagnose a bounce — keep that bound.

### 4. Magic links move to Selva

Implement `emailLink` Selva-side: mint a single-use token, render an
`auth.magic-link` template, dispatch through `notify()`.

This is not new crypto. `@selvajs/server/tokens` already exposes `createTokenCodec`,
and both invites (`invites/token.server.ts`) and share links
(`shareLinks/token.server.ts`) are thin bindings over it — mint raw, store only the
HMAC digest, hand the raw value out exactly once. A magic-link codec is the third
instance of an established pattern with an established test shape.

What this buys:

- The URL is built from Selva's own `ORIGIN`, so the `localhost:3000` failure cannot
  recur. It is not a config that can drift out of sync, because there is no second
  config.
- Magic-link mail looks like invite mail.
- The local/filesystem provider gets magic links, which today it cannot have at all —
  `emailLink` is implemented only by `SupabaseAuthProvider`. `IAuthProvider.emailLink`
  is already optional (`emailLink?:`) and every call site guards on it (`login`,
  `setup`, `auth/email/start`, `auth/email/callback`), so a second implementation
  needs no interface change and no route change.
- Supabase auth URL settings stop being operational knowledge anyone has to hold.

There is also a conformance suite waiting. `runEmailLinkAuthConformance` in
`@selvajs/platform/testing` tests the `IEmailLinkAuth` contract surface and is run
today only by `SupabaseEmailLinkAuth`. A Selva-side adapter runs the same suite
unchanged, so the contract is pinned before a line of it is written.

**The one real risk.** Selva starts storing auth tokens that Supabase stores today.
The pattern is known-good here and used twice, but "known-good pattern, third
application" is still a security surface and should get a proper review rather than a
quick port. Note what the conformance suite does _not_ cover, by its own admission:
the full round trip cannot be exercised without intercepting mail delivery, so expiry,
single-use enforcement, and replay need tests written specifically for the Selva
adapter. The invite and share-link tests are the model. This is why step 4 is last and
separable — everything before it is a refactor, and this one is a change in what Selva
is responsible for.

## Sequencing

Four steps, in dependency order. Sizes are relative, not estimates.

1. **Set Supabase Site URL + Redirect URLs.** Minutes, independent of everything
   else, and on its own enough to fix sign-in.
2. **Extract `packages/notifications`, add `INotificationProvider`, repoint invites.**
   A pure move — same mail, same behaviour, same tests. Worth doing on its own so
   that step 3 has somewhere to land.
3. **Add `notify()` and per-user preferences.** Driven by an actual first
   notification rather than built speculatively: pick the one we genuinely want and
   let it shape the seam.
4. **Selva-side magic links; drop GoTrue's mailer.** Optional in the sense that step
   1 already fixes the bug. Worth doing because it removes a class of config drift,
   not because sign-in is broken.

## Why `@selvajs/notifications` is private

Considered publishing it alongside `@selvajs/platform` and rejected, for now.

The package is Selva's own content: templates about Selva orgs, Selva invites, Selva
branding, with one consumer. That is not a library — it is the app's mail, extracted
so the app is not the only place it can live.

The extension point a third party actually needs is already public and already
elsewhere. `OutboundMessage` and `INotificationProvider` ship in `@selvajs/platform`,
so a self-hoster can implement a transport, or hand-build a message, without this
package existing. Publishing the concrete templates would not unlock anything that
is currently blocked.

Against that, publishing costs something immediately: every export becomes
semver-protected. `@selvajs/ui` is the cautionary case — an "unused" export there has
to be checked across the monorepo _and_ external consumers before it can be touched.
Taking on that guarantee is a bad trade while the shape is still moving, and it is
still moving in two specific ways: `notify()` may change what a template receives
(channel, preference metadata, resolved values vs. ids), and the magic-link template
is the second data point on what a template signature should look like. Neither has
landed.

The asymmetry settles it. Private → public is a version bump and one deleted line.
Public → private means unpublishing or deprecating something people may have
installed. Revisit when an external consumer actually appears — most plausibly a
self-hoster customising invite or magic-link copy rather than replacing it wholesale.

## Details worth carrying

- **Supabase's local stack** pins `site_url = "http://127.0.0.1:54421"` and
  `additional_redirect_urls = ["http://127.0.0.1:5173"]` in
  `packages/providers/supabase/supabase/config.toml`. Hosted projects are configured
  in the dashboard. Both need the fix in step 1; neither is reached by Selva code.
- **`ORIGIN`** must be set behind a proxy. Every link is built from `url.origin`
  (`invites/+server.ts`, `auth/email/start/+page.server.ts`), so without it invitees
  get an internal hostname. Already documented in `.env.example`.
- **`deliverInvite`** (`lib/server/invites/deliver.server.ts`) is already the shape
  `notify()` generalises: shared by the mint and resend routes precisely so they
  cannot disagree about what the invitee receives. It becomes the first caller to
  migrate, and it is the proof the seam is worth having.
- **`isMailConfigured()`** drives UI copy today. Its replacement needs to answer the
  same question — "can this instance send at all" — so admin screens can keep saying
  so.
