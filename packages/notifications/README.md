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

## Product name and wording

Templates take `productName` (default `Selva`) instead of naming the product. A
host that needs other wording or another language replaces a kind wholesale
through `MailTemplates`; `@selvajs/server` reads it from `deps.mailTemplates`
and passes `deps.instanceName` as `productName`. A replacement can reuse
`renderLayout`, `renderButton` and `renderUrlFallback(href, label)` for the frame,
and must return the built-in's `kind`.
