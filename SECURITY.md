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

Selva stores only opaque session tokens and minimal authorization data — auth
credentials and PII are owned by the configured auth provider (see
[CLAUDE.md § Data Privacy & Compliance](./CLAUDE.md#data-privacy--compliance)).
Reports involving credential handling, session management, the WebSocket bridge,
or the embedded HTTP server are especially welcome.
