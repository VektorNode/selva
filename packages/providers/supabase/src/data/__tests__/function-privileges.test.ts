/**
 * Who may call each `selva` function, checked against every migration applied
 * in order. `selva` is exposed through PostgREST and the anon key is
 * publishable, so a function's EXECUTE grant is its access control. Runs on
 * PGlite, without a live stack.
 */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asRole, migratedDb, seedUser } from './pglite-harness.js';

const SERVER = ['service_role'];
const SIGNED_IN = ['authenticated', 'service_role'];
const ANYONE = ['anon', 'authenticated', 'service_role'];

// Every `selva` function, so a new one fails here until someone decides who may
// call it. RLS policies run their helpers as the querying role, so those stay
// open: they only answer questions about the caller.
const EXECUTE_GRANTS = {
	'selva.claim_first_instance_admin(uuid,text[])': SERVER,
	'selva.delegated_org()': ANYONE,
	'selva.get_invite_by_token_hash(text)': ANYONE,
	'selva.handle_new_auth_user()': SERVER,
	'selva.has_org_permission(uuid,text)': ANYONE,
	'selva.increment_run_count(uuid)': SIGNED_IN,
	'selva.is_instance_admin()': ANYONE,
	'selva.is_org_admin(uuid)': ANYONE,
	'selva.is_org_member(uuid)': ANYONE,
	'selva.is_org_owner(uuid)': ANYONE,
	'selva.is_project_member(uuid)': ANYONE,
	'selva.is_project_owner(uuid)': ANYONE,
	'selva.may_seed_project_owner(uuid)': ANYONE,
	'selva.in_token_scope(uuid)': ANYONE,
	'selva.is_commons_contributor(uuid,uuid)': ANYONE,
	'selva.is_definition_contributor(uuid)': ANYONE,
	'selva.is_definition_editor(uuid)': ANYONE,
	'selva.is_project_editor(uuid)': ANYONE,
	'selva.is_unfinished_commons_upload(uuid)': ANYONE,
	'selva.leads_definition_org(uuid)': ANYONE,
	'selva.may_issue_invite(uuid,text,text[])': ANYONE,
	'selva.may_set_org_role(uuid,text)': ANYONE,
	'selva.may_upload_to_commons(uuid,uuid)': ANYONE,
	'selva.org_share_link_roster(uuid,integer,integer)': SIGNED_IN,
	'selva.remove_org_member(uuid,uuid)': SIGNED_IN,
	'selva.shares_org_with(uuid)': ANYONE,
	'selva.migration_head()': SERVER,
	'selva.redact_audit_event_email(text)': SERVER,
	'selva.refuse_disabled_caller()': ANYONE,
	'selva.save_org_compute_servers(uuid,jsonb,boolean,uuid)': SIGNED_IN,
	'selva.save_platform_compute_servers(jsonb,jsonb,uuid)': SIGNED_IN,
	'selva.reserve_next_version_number(uuid)': SIGNED_IN,
	'selva.set_platform_permissions(uuid,text[])': SERVER,
	'selva.set_updated_at()': SERVER,
	'selva.sync_auth_user_disabled()': SERVER,
	'selva.try_increment_share_link_solve_count(uuid)': SERVER,
	'selva.visible_project(uuid)': ANYONE
};

describe('selva function privileges', () => {
	let db: PGlite;

	beforeAll(async () => {
		db = await migratedDb();
	});

	it('refuses anon on set_platform_permissions', async () => {
		const nobody = await seedUser(db);
		await expect(
			asRole(db, 'anon', `select selva.set_platform_permissions($1, '{instance_admin}')`, [nobody])
		).rejects.toThrow(/permission denied for function/);
	});

	it('grants EXECUTE on each function to exactly the roles that call it', async () => {
		const { rows } = await db.query<{ fn: string; roles: string[] }>(`
			select p.oid::regprocedure::text as fn,
				array(
					select role
					from unnest(array['anon', 'authenticated', 'service_role']) as role
					where has_function_privilege(role, p.oid, 'execute')
				) as roles
			from pg_proc p
			where p.pronamespace = 'selva'::regnamespace
		`);
		expect(Object.fromEntries(rows.map((r) => [r.fn, r.roles]))).toEqual(EXECUTE_GRANTS);
	});

	it('closes a new function to anon and authenticated once it revokes from public', async () => {
		const open = await db.transaction(async (tx) => {
			await tx.exec(`
				create function selva.probe() returns integer language sql as 'select 1';
				revoke execute on function selva.probe() from public;
			`);
			const { rows } = await tx.query<{ role: string }>(`
				select role
				from unnest(array['anon', 'authenticated']) as role
				where has_function_privilege(role, 'selva.probe()', 'execute')
			`);
			await tx.rollback();
			return rows;
		});
		expect(open).toEqual([]);
	});

	it('still seeds a profile when the auth service creates a user', async () => {
		const [{ id }] = await asRole<{ id: string }>(
			db,
			'supabase_auth_admin',
			`insert into auth.users default values returning id`
		);
		const { rows } = await db.query(`select 1 from selva.user_profiles where user_id = $1`, [id]);
		expect(rows).toHaveLength(1);
	});

	it('still runs RLS helpers and updated_at triggers for a signed-in owner', async () => {
		const owner = await seedUser(db);
		const orgId = crypto.randomUUID();
		await db.query(
			`insert into selva.orgs (id, name, slug, owner_id, updated_at)
			 values ($1, 'Acme', 'acme', $2, '2000-01-01')`,
			[orgId, owner]
		);
		await db.query(
			`insert into selva.org_members (org_id, user_id, role) values ($1, $2, 'owner')`,
			[orgId, owner]
		);

		const updated = await asRole<{ bumped: boolean }>(
			db,
			'authenticated',
			`update selva.orgs set name = 'Renamed' where id = $1
			 returning updated_at > '2000-01-02' as bumped`,
			[orgId],
			{ sub: owner }
		);

		expect(updated).toEqual([{ bumped: true }]);
	});
});
