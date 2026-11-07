---
'@selvajs/platform': minor
'@selvajs/supabase-provider': patch
'@selvajs/local-provider': patch
---

Deleting a user on Supabase removes the invites addressed to them, and redacts their address from `invite.created` audit payloads, whatever case the address arrives in. Before, an address whose case differed from the stored, lowercased one left those rows behind. The local provider already matched case-insensitively; it no longer emits an `org_member.removed` event for each org it erases the user from.

Conformance kit: `runUserErasureConformance` checks what `IDataProvider.onUserDeleted` removes (invites to and from the user, their API tokens, memberships and profile) and what it keeps (the orgs and projects they owned, under `ERASED_ACTOR_ID`). `runProjectStoreConformance` takes `orgScoping`, with `otherOrgId` from `createStore`, to check that slug lookups and listings stay inside the org asked for.
