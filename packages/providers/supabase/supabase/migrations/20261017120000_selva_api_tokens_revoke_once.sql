-- ============================================================================
-- A revoked API token stays revoked
--
-- Sessions may update `revoked_at` and nothing else. The revoke policy's
-- WITH CHECK also requires the row to end up revoked, so an owner can't write
-- `revoked_at = null` to revive a key an admin or `member_removed` revoked.
-- ============================================================================

drop policy "api_tokens: owner or org leadership can revoke" on selva.api_tokens;

create policy "api_tokens: owner or org leadership can revoke"
on selva.api_tokens for update
to authenticated
using (user_id = auth.uid() or selva.has_org_permission(org_id, 'manage_org_members'))
with check (
	revoked_at is not null
	and (user_id = auth.uid() or selva.has_org_permission(org_id, 'manage_org_members'))
);
