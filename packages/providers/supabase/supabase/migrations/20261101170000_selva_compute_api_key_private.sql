-- ============================================================================
-- Sessions cannot read compute_servers.api_key
--
-- RLS is per row, so anyone who could see a shared platform server could also
-- select its ciphertext and try to replay it. The store reads keys with the
-- service role, after a session read has said which servers the caller sees.
-- ============================================================================

revoke select on selva.compute_servers from anon, authenticated;

grant select (
	id, scope, owner_org_id, shared_with_all, label, server_url,
	timeout_ms, retry_count, created_at, has_api_key
) on selva.compute_servers to authenticated;
