# @selvajs/notifications

Message templates for Selva's outbound mail. Pure render: data in,
`OutboundMessage` out. No I/O, no env, no transport.

```ts
import { renderInviteEmail } from '@selvajs/notifications';

const message = renderInviteEmail({ to, acceptUrl, orgName, expiresAt });
await provider.send(message, log); // an INotificationProvider the host wires up
```

## Where this sits

Three pieces, deliberately kept apart:

| Piece                      | Owns                          | Lives               |
| -------------------------- | ----------------------------- | ------------------- |
| `INotificationProvider`    | putting a message on the wire | `@selvajs/platform` |
| `SmtpNotificationProvider` | doing that over SMTP          | `@selvajs/server`   |
| Templates (this package)   | what the message says         | here                |

A template never fetches. It takes resolved values — `orgName`, not `orgId` —
because a template that can fetch is a template that can fail, and mail is
rendered on a path where failing is not an option.

## Adding a template

Build on `renderLayout` rather than writing a fresh document. The wrapper owns the
card chrome, type stack, and colours, so mail written by different people at
different times still reads as coming from one product.

Two rules the invite template demonstrates and the tests enforce:

- **Both parts carry the payload.** A mail that degrades to plain text must still
  contain the link. If the point of the mail is a URL, the text part needs it.
- **Everything interpolated goes through `escapeHtml`** — including URLs. An accept
  URL carries a token, and a token can contain characters that close an `href`
  early.

Tag the result with its `NotificationKind` (declared in
`@selvajs/platform/notifications`) so the dispatcher can route it and honour a
user's per-kind preferences.

## Not published

Private on purpose. Everything here is Selva's own content — templates about Selva
orgs, Selva invites, Selva branding — with one consumer, the Selva app.

The extension point is already public and lives elsewhere: `OutboundMessage` and
`INotificationProvider` ship in `@selvajs/platform`, so a self-hoster can implement
a transport or hand-build a message without this package existing.

**Worth revisiting.** Publish this if someone outside the app needs to render Selva
mail — most plausibly a self-hoster customising invite or magic-link copy rather
than replacing it wholesale. Two things should settle first, because both are
likely to move the exported shape:

- `notify()` may change what a template receives (channel, preference metadata,
  resolved-vs-id inputs).
- The magic-link template lands in the same pass and is the second data point on
  what a template signature wants to look like.

Publishing makes every export semver-protected, and that is a bad trade while the
shape is still moving. Going private → public later is a version bump; going back
is not. See `plans/features/notifications.md`.
