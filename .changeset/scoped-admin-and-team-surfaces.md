---
'@selvajs/selva': minor
---

`/admin/users` and `/team/members` split along the scope they actually govern, and an invite to an existing account joins it to the org instead of failing.

## One surface per scope

The two pages overlapped because `/admin/users` edited org memberships and minted org invites — work that belongs to `/team/members` under `manage_org_members`. `/admin/users` is now platform-scoped only: it lists identities, edits the four `PlatformPermission` values, and deletes users. Org role and permissions render there read-only, linking to Members & roles.

Invites live at `/team/members` alone. The duplicate form, copy-link banner, and invites card are gone from `/admin/users`; both pages were already calling the same `/api/v1/orgs/{orgId}/invites` endpoint, so nothing moved — the second copy was deleted.

**`PATCH /api/admin/users/[id]` no longer writes org memberships.** It gated only on `manage_instance_users` and wrote through `SYSTEM_CONTEXT`, so a caller who was not a member of the acting org and held no `manage_org_members` could still rewrite that org's permissions — including resetting an owner's — and the sole-owner invariant that `/api/v1/orgs/{orgId}/members/{userId}` enforces never ran. The body now accepts platform permissions only.

`POST /api/admin/users` keeps attaching new users to the acting org, as a bare `member` with no permissions: under header-auth the IdP holds the credential, so there is no invite to accept and this is the only way in. Access is granted afterwards at Members & roles.

`GET /api/admin/users` returns `platformPermissions`, `orgRole`, and `orgPermissions` instead of one merged `permissions` array. `/api/admin/*` is unversioned and internal, and its only consumer is its own page.

## Inviting someone who already has an account

Accepting an invite assumed the invitee was new and always created an account, so an email that already had one hit the provider's duplicate error. The page now resolves the email first and takes a `join` mode when the account exists: no signup, just the membership. This is what multi-tenant needs — one person, one login, several orgs.

**`join` requires a session belonging to the invitee.** The token proves the invite is genuine, not that the visitor is the person it names; for a new account that gap closes itself, because accepting is what mints the identity. An existing account has to prove it is theirs, or a forwarded link would let anyone join an org as someone else.

Re-accepting an invite to an org you are already in consumes the invite and leaves the membership untouched. `addOrgMember` upserts in both adapters, so an unguarded accept of a `member` invite would have demoted an existing owner.

## One admission path per provider

The allowlist form appeared wherever the provider implemented `createUser`, which says a provider _can_ allowlist, not that it _should_. It is now shown only where no credential-owning path exists (`createUser && !passwordAuth`).

On Supabase that removes a second, confusing route to the same goal — and a trap: allowlisting minted a confirmed `auth.users` row with no password, so unless magic-link or OAuth happened to be configured, it created a user who could not sign in at all. Header-auth is unchanged, since allowlisting is the only way into those deployments. Where the form is hidden, the page links to Members & roles rather than offering a second invite form.

## "User" and "member" mean different things, and the copy now says so

A user is an identity that can sign in; a member is one user's role and permissions inside one org. The same person is an owner of one org and a plain member of another, so a role is never a property of the person — only of the pairing. The API layers already respected this; the UI leaked across it.

- The cross-link from `/admin/users` said `Invite user` for the button that `/team/members` calls `Invite member` — one action, two names. It mints an org invite, so it is member vocabulary.
- The `invited` badge is now `never signed in`. It keys off `lastLoginAt`, so on an allowlisted identity no invite was ever sent; the tooltip already said "provisioned".
- Filters read `All org roles` and `All instance permissions` rather than `All roles` and `All permissions`. Both scopes appear in one filter row, and the role one describes the acting org only — a distinction multi-tenant makes load-bearing.
- One timestamp, one label: the roster showed `joinedAt` as either "Joined" or "Invited" depending on `lastLoginAt`, an unrelated fact. It now always reads "Joined", with "never signed in" appended separately.
- Smaller: `Manage members` → `Manage org members` on the admin page, matching its `Manage org compute` sibling; the member PATCH toast names its object (`Member updated`) instead of a bare `Updated`; the two permission-label maps that render side by side no longer differ in casing; "teammates" and "Go to login" are gone, each having been the only occurrence of a term used differently everywhere else.

`docs/self-hosting/concepts/permissions.md` gains the vocabulary section this was missing — it already drew the distinction most carefully, so the words live next to the model rather than in a glossary of their own. The Entra guide pointed at **Admin → Users → New user**, a control that does not exist; it now names `Allowlist user` and the org step that follows it.
