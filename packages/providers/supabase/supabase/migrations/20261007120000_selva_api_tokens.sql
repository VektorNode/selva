-- ============================================================================
-- API tokens
--
-- Long-lived bearer keys, each acting as one user inside one org. Only the
-- HMAC of the key is stored. Resolving a key and recording its use run as
-- service role: there is no session yet when a key is checked. Everything a
-- signed-in person does (mint, list, revoke) goes through these policies.
-- ============================================================================

create table if not exists selva.api_tokens (
	id uuid primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	-- Equal to user_id until service accounts exist; null once the minter is erased.
	created_by uuid references auth.users(id) on delete set null,
	org_id uuid not null references selva.orgs(id) on delete cascade,
	name text not null check (char_length(name) between 1 and 100),
	token_hash text not null unique,
	scopes text[] not null check (cardinality(scopes) between 1 and 20),
	created_at timestamptz not null default now(),
	expires_at timestamptz not null,
	last_used_at timestamptz,
	-- Revoked rows stay so a token id in the audit log still resolves to a name.
	revoked_at timestamptz
);

create index if not exists idx_api_tokens_org on selva.api_tokens(org_id, created_at desc);
create index if not exists idx_api_tokens_user_live
	on selva.api_tokens(user_id) where revoked_at is null;

alter table selva.api_tokens enable row level security;

-- Sessions never read the hash and may only ever change `revoked_at`: scopes,
-- expiry and owner are fixed at mint. The hash is useless without the server's
-- HMAC key, but there's no reason to hand it out.
revoke all on selva.api_tokens from anon, authenticated;
grant select (id, user_id, created_by, org_id, name, scopes, created_at, expires_at, last_used_at, revoked_at)
	on selva.api_tokens to authenticated;
grant insert on selva.api_tokens to authenticated;
grant update (revoked_at) on selva.api_tokens to authenticated;
grant delete on selva.api_tokens to authenticated;

-- Owners see their own keys. Org leadership sees the whole roster for
-- offboarding, gated on manage_org_members as the share-link roster is.
create policy "api_tokens: owner or org leadership can read"
on selva.api_tokens for select
to authenticated
using (user_id = auth.uid() or selva.has_org_permission(org_id, 'manage_org_members'));

-- Only for yourself, in an org you belong to. Who may mint (manage_api_tokens)
-- and which scopes are allowed is checked by the app before the insert.
create policy "api_tokens: members mint their own"
on selva.api_tokens for insert
to authenticated
with check (
	user_id = auth.uid()
	and created_by = auth.uid()
	and selva.is_org_member(org_id)
);

create policy "api_tokens: owner or org leadership can revoke"
on selva.api_tokens for update
to authenticated
using (user_id = auth.uid() or selva.has_org_permission(org_id, 'manage_org_members'))
with check (user_id = auth.uid() or selva.has_org_permission(org_id, 'manage_org_members'));

-- Deleting an org is a soft delete, which never fires the FK cascade, so the
-- org cascade removes its keys explicitly.
create policy "api_tokens: removed with their org"
on selva.api_tokens for delete
to authenticated
using (selva.is_org_owner(org_id) or selva.is_instance_admin());

-- ============================================================================
-- audit_events.token_id
--
-- Set on every event written during an API-token request (the payload already
-- carries it as `tokenId`). A column so "what did this key do?" is an index
-- lookup. No FK: the audit log outlives the token rows.
-- ============================================================================

alter table selva.audit_events add column if not exists token_id uuid;

create index if not exists audit_events_token_occurred_at_idx
	on selva.audit_events (token_id, occurred_at desc)
	where token_id is not null;
