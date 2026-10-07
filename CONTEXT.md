# Selva

Platform-level glossary. Package-specific terms live in `packages/*/CONTEXT.md`.

## Language

### API access

**API token**:
A long-lived `selva_` bearer credential minted by a user, acting as that user with permissions narrowed by its scopes.
_Avoid_: PAT, machine key

**Scope**:
One grant on an API token: an action (`read`, `write`, `solve`) paired with a resource (`all`, an org, a project, or a definition). `write` and `solve` each include `read`.
_Avoid_: permission (that is what a user holds; scopes only narrow it)

**Service account**:
A user that cannot log in, existing only to own API tokens for an integration that should outlive the person who set it up.
_Avoid_: service principal, bot user

**Host app**:
An application that embeds `@selvajs/*` packages behind its own request hook, rather than running the Selva app.
_Avoid_: consumer app, embedding app

**Delegated session**:
A short-lived session minted server-side for an API token's user, so per-user data rules apply as if that user were signed in.
_Avoid_: impersonation token, service JWT
