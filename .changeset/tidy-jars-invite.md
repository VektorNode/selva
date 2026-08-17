---
'@selvajs/supabase-provider': minor
'@selvajs/platform': minor
'@selvajs/selva': minor
---

Invites carry instance permissions; admins no longer set another user's password.

Creating a user had two shapes depending on the provider: an admin typed someone
else's password (Local, Supabase), or allowlisted an email and let the IdP hold
the credential (header-auth/Entra). The first is now gone. A provider that owns
credentials admits users by invite, so the account holder is the only party who
ever chooses their password.

That removal needed a replacement first: the admin-sets-password form was the
only way to create a second instance admin, so deleting it alone would have left
a deployment stuck with the admin it bootstrapped with. Invites now carry
`platformPermissions`, mintable only by a caller who already holds
`instance_admin` — `manage_org_members` is enough to invite people, so without
that check an org admin could mint themselves an admin invite and accept it.

The allowlist path (`createUser`) is untouched — it is the only way into a
header-auth deployment, and it is now the sole branch of `POST /api/admin/users`.
The local provider implements no `createUser`, so that route reports 501 there
and points at invites; the admin UI hides the form to match.

In the invite form, platform permissions render as their own group. The
owner/admin role lock renders a checkbox as checked-and-disabled, and reusing it
across scopes would have granted `instance_admin` to every owner invite.

Requires `supabase db push` — adds `selva.invites.platform_permissions`.
