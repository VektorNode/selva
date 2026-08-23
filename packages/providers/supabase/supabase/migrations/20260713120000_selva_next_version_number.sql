-- ============================================================================
-- Monotonic per-definition version-number allocator (audit DC / caching Phase 1.5)
-- ============================================================================
--
-- Root-cause fix for `fileKey` reuse: `uploadVersion` used to compute the next
-- version number as max(existing)+1, so deleting the latest version freed its
-- number and the next upload reused it — reusing the `fileKey`
-- (`versions/v{N}.gh`) and letting a stale storage blob (or any layer keying on
-- the key) serve the old version's bytes for new content.
--
-- The `next_version_number` counter lives on the definition row and only ever
-- advances. `reserve_next_version_number` returns the current value and bumps it
-- atomically, so concurrent uploads never collide and a deleted version's number
-- is never handed out again.

-- Column: defaults to 2 (v1 is created with the parent, so the next upload takes
-- 2). Backfilled below for any pre-existing rows.
alter table selva.definitions
	add column if not exists next_version_number integer not null default 2;

-- Backfill existing definitions to one past their highest live version number,
-- so already-uploaded versions don't get their numbers reused. Idempotent: after
-- the first run the counter is already >= this, and greatest() keeps it from
-- ever moving backwards.
update selva.definitions d
set next_version_number = greatest(
	d.next_version_number,
	coalesce(
		(select max(v.version_number) + 1
		 from selva.definition_versions v
		 where v.definition_guid = d.guid),
		2
	)
);

-- Atomic reserve-and-increment. Returns the reserved number (the value BEFORE
-- the bump) and advances the counter. Never decrements. Raises if the row is
-- missing or soft-deleted so the caller surfaces a 404 rather than silently
-- minting a number for a dead definition.
create or replace function selva.reserve_next_version_number(g uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
	reserved integer;
begin
	update selva.definitions
	set next_version_number = next_version_number + 1
	where guid = g and deleted_at is null
	returning next_version_number - 1 into reserved;

	if reserved is null then
		raise exception 'definition % not found', g using errcode = 'no_data_found';
	end if;

	return reserved;
end;
$$;
grant execute on function selva.reserve_next_version_number(uuid) to authenticated, service_role;
