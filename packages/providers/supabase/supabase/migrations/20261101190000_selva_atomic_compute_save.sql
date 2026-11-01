-- ============================================================================
-- A compute save lands whole or not at all
--
-- Security invoker, so the existing policies still decide who may write. Rows
-- that stay are updated rather than deleted and reinserted: deleting clears
-- `compute_server_org_defaults` through its FK. The update comes before an
-- `on conflict do nothing` insert because reading `excluded.api_key` would need
-- the SELECT that sessions no longer have on that column.
-- ============================================================================

create or replace function selva.save_platform_compute_servers(
	servers jsonb,
	shares jsonb,
	default_server uuid
)
returns void
language plpgsql set search_path = public
as $$
declare
	submitted integer := jsonb_array_length(servers);
	saved integer;
	added integer;
begin
	delete from selva.compute_servers c
	where c.scope = 'platform'
	and c.id not in (select (s ->> 'id')::uuid from jsonb_array_elements(servers) s);

	update selva.compute_servers c
	set label = x.label, server_url = x.server_url, api_key = x.api_key,
		timeout_ms = x.timeout_ms, retry_count = x.retry_count,
		shared_with_all = x.shared_with_all
	from jsonb_to_recordset(servers) as x(
		id uuid, label text, server_url text, api_key text,
		timeout_ms integer, retry_count integer, shared_with_all boolean
	)
	where c.id = x.id and c.scope = 'platform';
	get diagnostics saved = row_count;

	insert into selva.compute_servers
		(id, scope, label, server_url, api_key, timeout_ms, retry_count, shared_with_all)
	select x.id, 'platform', x.label, x.server_url, x.api_key, x.timeout_ms, x.retry_count,
		x.shared_with_all
	from jsonb_to_recordset(servers) as x(
		id uuid, label text, server_url text, api_key text,
		timeout_ms integer, retry_count integer, shared_with_all boolean
	)
	on conflict (id) do nothing;
	get diagnostics added = row_count;

	-- The insert skips what the update handled, so the two only fall short on a
	-- collision.
	if saved + added < submitted then
		raise exception 'A compute server id is already in use' using errcode = '23505';
	end if;

	delete from selva.compute_server_shares cs
	using selva.compute_servers c
	where c.id = cs.server_id and c.scope = 'platform';

	insert into selva.compute_server_shares (server_id, org_id)
	select x.server_id, x.org_id
	from jsonb_to_recordset(shares) as x(server_id uuid, org_id uuid);

	update selva.compute_server_platform_default
	set default_server_id = default_server
	where singleton;
end;
$$;

-- `set_default` is false to leave the org's default as it stands, whatever
-- `default_server` holds; with it true, a null `default_server` clears it.
create or replace function selva.save_org_compute_servers(
	o uuid,
	servers jsonb,
	set_default boolean,
	default_server uuid
)
returns void
language plpgsql set search_path = public
as $$
declare
	submitted integer := jsonb_array_length(servers);
	saved integer;
	added integer;
begin
	delete from selva.compute_servers c
	where c.scope = 'org' and c.owner_org_id = o
	and c.id not in (select (s ->> 'id')::uuid from jsonb_array_elements(servers) s);

	update selva.compute_servers c
	set label = x.label, server_url = x.server_url, api_key = x.api_key,
		timeout_ms = x.timeout_ms, retry_count = x.retry_count
	from jsonb_to_recordset(servers) as x(
		id uuid, label text, server_url text, api_key text,
		timeout_ms integer, retry_count integer
	)
	where c.id = x.id and c.scope = 'org' and c.owner_org_id = o;
	get diagnostics saved = row_count;

	insert into selva.compute_servers
		(id, scope, owner_org_id, label, server_url, api_key, timeout_ms, retry_count)
	select x.id, 'org', o, x.label, x.server_url, x.api_key, x.timeout_ms, x.retry_count
	from jsonb_to_recordset(servers) as x(
		id uuid, label text, server_url text, api_key text,
		timeout_ms integer, retry_count integer
	)
	on conflict (id) do nothing;
	get diagnostics added = row_count;

	-- A colliding id belongs to another org or the platform, and this says no more
	-- than that: the session may not be able to see the row.
	if saved + added < submitted then
		raise exception 'A compute server id is already in use' using errcode = '23505';
	end if;

	if set_default then
		if default_server is null then
			delete from selva.compute_server_org_defaults where org_id = o;
		else
			insert into selva.compute_server_org_defaults (org_id, default_server_id)
			values (o, default_server)
			on conflict (org_id) do update set default_server_id = excluded.default_server_id;
		end if;
	end if;
end;
$$;

revoke all on function
	selva.save_platform_compute_servers(jsonb, jsonb, uuid),
	selva.save_org_compute_servers(uuid, jsonb, boolean, uuid)
from public, anon;

grant execute on function
	selva.save_platform_compute_servers(jsonb, jsonb, uuid),
	selva.save_org_compute_servers(uuid, jsonb, boolean, uuid)
to authenticated, service_role;
