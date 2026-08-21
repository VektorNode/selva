# Security Policy

## Supported Versions

Selva is pre-1.0 and evolving quickly. Security fixes target the latest published
release of each package (`@selvajs/*` on npm) and the latest tagged plugin release.
We don't backport fixes to older versions.

## Reporting a Vulnerability

Please report security vulnerabilities privately using
[GitHub Security Advisories](https://github.com/VektorNode/selva/security/advisories/new)
("Report a vulnerability" under the Security tab of this repo). Do not open a public
issue for security reports.

Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal repro is very helpful)
- Affected package(s)/version(s) or plugin build

We aim to acknowledge new reports within 5 business days and will keep you updated
as we investigate and fix the issue. We'll credit reporters in the advisory unless
you'd prefer to stay anonymous.

## Scope

Selva holds personal data — session tokens, user ids and permissions, display
names, invite emails, and audit-event payloads. How much identity data lives
elsewhere depends on the auth provider: with Supabase, credentials sit in
Supabase `auth.users`; with the local provider, Selva _is_ the auth provider and
stores emails and PBKDF2 password hashes on its own disk. See
[Data privacy](./docs/self-hosting/concepts/data-privacy.md).

Reports involving credential handling, session management, the WebSocket bridge,
or the embedded HTTP server are especially welcome.
