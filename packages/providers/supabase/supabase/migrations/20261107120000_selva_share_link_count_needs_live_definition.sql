-- ============================================================================
-- A share link stops counting solves once its definition is soft-deleted
--
-- Token resolution already hides such a link (`getByTokenHash` joins
-- `definitions`), so the counter agrees with it rather than spending the cap of
-- a definition nobody can solve. `create or replace` keeps the existing grants:
-- service role only.
-- ============================================================================

create or replace function selva.try_increment_share_link_solve_count(link_id uuid)
returns integer
language sql security definer set search_path = public
as $$
	update selva.share_links s
	set solve_count = s.solve_count + 1
	where s.id = link_id
	  and s.revoked_at is null
	  and (s.expires_at is null or s.expires_at > now())
	  and (s.max_solves is null or s.solve_count < s.max_solves)
	  and exists (
		select 1 from selva.definitions d
		where d.guid = s.definition_guid and d.deleted_at is null
	  )
	returning s.solve_count;
$$;
