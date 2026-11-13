/**
 * The boundary a session JWT meets when it skips Selva and calls PostgREST: it
 * may read what RLS shows it and write nothing. The anon key is publishable, so
 * this is the boundary, not a backstop. Who may change what is the app's rule
 * (`access/rules.ts`); the stores write with the service role once it has passed.
 */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	actAs,
	asRole,
	migratedDb,
	seedDefinition,
	seedOrg,
	seedOrgMember,
	seedProject,
	seedProjectMember,
	seedShareLink,
	seedUser
} from './pglite-harness.js';

let db: PGlite;
let owner: string;
let admin: string;
let member: string;
let acme: string;

beforeAll(async () => {
	db = await migratedDb();
	owner = await seedUser(db);
	admin = await seedUser(db);
	member = await seedUser(db);
	acme = await seedOrg(db, owner);
	await seedOrgMember(db, acme, admin, 'admin', ['manage_org_members']);
	await seedOrgMember(db, acme, member, 'member');
});

const SESSION_ROLES = ['authenticated', 'anon'] as const;

describe('sessions cannot write', () => {
	it('holds no write privilege on any selva table', async () => {
		const { rows } = await db.query(
			`select grantee, table_name, privilege_type
			 from information_schema.role_table_grants
			 where table_schema = 'selva' and grantee in ('anon', 'authenticated')
			 and privilege_type <> 'SELECT'`
		);
		expect(rows).toEqual([]);
	});

	it('holds no column-level write privilege either', async () => {
		const { rows } = await db.query(
			`select grantee, table_name, column_name, privilege_type
			 from information_schema.column_privileges
			 where table_schema = 'selva' and grantee in ('anon', 'authenticated')
			 and privilege_type <> 'SELECT'`
		);
		expect(rows).toEqual([]);
	});

	it('refuses insert, update and delete on every table, for an org owner too', async () => {
		const { rows } = await db.query<{ tablename: string; col: string }>(
			`select table_name as tablename, min(column_name) as col
			 from information_schema.columns where table_schema = 'selva'
			 and table_name in (select tablename from pg_tables where schemaname = 'selva')
			 group by table_name order by table_name`
		);
		expect(rows.length).toBeGreaterThan(10);
		for (const role of SESSION_ROLES) {
			const claims = role === 'authenticated' ? { sub: owner } : {};
			for (const { tablename, col } of rows) {
				for (const sql of [
					`insert into selva.${tablename} default values`,
					`update selva.${tablename} set ${col} = ${col}`,
					`delete from selva.${tablename}`
				]) {
					await expect(asRole(db, role, sql, [], claims), `${role}: ${sql}`).rejects.toThrow(
						/permission denied/
					);
				}
			}
		}
	});

	it('leaves no write policy behind', async () => {
		const { rows } = await db.query(
			`select tablename, policyname, cmd from pg_policies
			 where schemaname = 'selva' and cmd <> 'SELECT'`
		);
		expect(rows).toEqual([]);
	});

	it('starts a new table closed', async () => {
		const grants = await db.transaction(async (tx) => {
			await tx.exec(`create table selva.probe (id uuid primary key)`);
			const { rows } = await tx.query(
				`select grantee, privilege_type from information_schema.role_table_grants
				 where table_schema = 'selva' and table_name = 'probe'
				 and grantee in ('anon', 'authenticated')`
			);
			await tx.rollback();
			return rows;
		});
		expect(grants).toEqual([]);
	});

	it('refuses the functions that write', async () => {
		const calls = [
			`select selva.remove_org_member('${acme}', '${member}', null)`,
			`select selva.increment_run_count(gen_random_uuid())`,
			`select selva.reserve_next_version_number(gen_random_uuid())`,
			`select selva.save_platform_compute_servers('[]', '[]', null)`,
			`select selva.save_org_compute_servers('${acme}', '[]', false, null)`,
			`select selva.set_platform_permissions('${owner}', '{instance_admin}')`,
			`select selva.claim_first_instance_admin('${owner}', '{instance_admin}')`
		];
		for (const sql of calls) {
			await expect(actAs(db, { sub: owner }, sql), sql).rejects.toThrow(
				/permission denied for function/
			);
		}
	});
});

describe('direct writes a session might attempt', () => {
	it("refuses a version row that names another definition's file", async () => {
		const project = await seedProject(db, acme, owner);
		await seedProjectMember(db, project, owner, 'owner');
		const mine = await seedDefinition(db, project, owner);
		const theirs = await seedDefinition(db, project, admin);
		await expect(
			actAs(
				db,
				{ sub: owner },
				`insert into selva.definition_versions
					(id, definition_guid, version_number, file_ext, file_key, original_filename, uploaded_by)
				 values (gen_random_uuid(), $1, 2, 'gh', $2, 'x.gh', $3)`,
				[mine, `definitions/${theirs}/versions/v1.gh`, owner]
			)
		).rejects.toThrow(/permission denied/);
	});

	it('refuses adding a user to an org without an invite', async () => {
		const stranger = await seedUser(db);
		await expect(
			actAs(
				db,
				{ sub: owner },
				`insert into selva.org_members (org_id, user_id, role, joined_at)
				 values ($1, $2, 'member', '1970-01-01')`,
				[acme, stranger]
			)
		).rejects.toThrow(/permission denied/);
	});

	it('refuses moving a project to another org or making it public', async () => {
		const other = await seedOrg(db, await seedUser(db));
		const project = await seedProject(db, acme, owner);
		await seedProjectMember(db, project, owner, 'owner');
		for (const set of [`org_id = '${other}'`, `visibility = 'public'`]) {
			await expect(
				actAs(db, { sub: owner }, `update selva.projects set ${set} where id = $1`, [project])
			).rejects.toThrow(/permission denied/);
		}
	});

	it('refuses a removed creator making themselves project owner again', async () => {
		const creator = await seedUser(db);
		await seedOrgMember(db, acme, creator, 'member');
		const project = await seedProject(db, acme, creator);
		await expect(
			actAs(
				db,
				{ sub: creator },
				`insert into selva.project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
				[project, creator]
			)
		).rejects.toThrow(/permission denied/);
	});

	it('refuses a self-made API token, compute server, invite and share-link un-revoke', async () => {
		const project = await seedProject(db, acme, owner);
		await seedProjectMember(db, project, owner, 'owner');
		const link = await seedShareLink(db, await seedDefinition(db, project, owner), owner);
		const attempts: [string, unknown[]][] = [
			[
				`insert into selva.api_tokens (id, user_id, created_by, org_id, name, token_hash, scopes, expires_at)
				 values (gen_random_uuid(), $1, $1, $2, 'k', 'sha256:x', '{}', '2099-01-01')`,
				[owner, acme]
			],
			[
				`insert into selva.compute_servers (id, scope, owner_org_id, label, server_url)
				 values (gen_random_uuid(), 'org', $1, 'x', 'http://169.254.169.254/')`,
				[acme]
			],
			[
				`insert into selva.invites (id, token_hash, email, org_id, org_role, org_permissions, invited_by, expires_at)
				 values (gen_random_uuid(), 'h', 'x@evil.io', $1, 'owner', '{}', $2, '2099-01-01')`,
				[acme, owner]
			],
			[`update selva.share_links set revoked_at = null, solve_count = 0 where id = $1`, [link]]
		];
		for (const [sql, params] of attempts) {
			await expect(actAs(db, { sub: owner }, sql, params), sql).rejects.toThrow(
				/permission denied/
			);
		}
	});
});

describe('invariants that hold for the app too', () => {
	const insertVersion = `insert into selva.definition_versions
		(id, definition_guid, version_number, file_ext, file_key, original_filename, uploaded_by)
		values (gen_random_uuid(), $1, 2, 'gh', $2, 'x.gh', $3)`;

	it("ties a version's file key to its own definition and number", async () => {
		const project = await seedProject(db, acme, owner);
		const mine = await seedDefinition(db, project, owner);
		const theirs = await seedDefinition(db, project, admin);

		await expect(
			asRole(db, 'service_role', insertVersion, [
				mine,
				`definitions/${theirs}/versions/v1.gh`,
				owner
			])
		).rejects.toThrow(/must name its own file/);
		await asRole(db, 'service_role', insertVersion, [
			mine,
			`definitions/${mine}/versions/v2.gh`,
			owner
		]);
	});

	it('lets a legacy row outlive its uploader and take a schema', async () => {
		const project = await seedProject(db, acme, owner);
		const guid = await seedDefinition(db, project, owner);
		const uploader = await seedUser(db);
		const trigger = 'trg_definition_versions_file_key_is_own';
		await db.exec(`alter table selva.definition_versions disable trigger ${trigger}`);
		await db.query(insertVersion, [guid, 'legacy/key.gh', uploader]);
		await db.exec(`alter table selva.definition_versions enable trigger ${trigger}`);

		await asRole(
			db,
			'service_role',
			`update selva.definition_versions set schema = '{}' where file_key = 'legacy/key.gh'`
		);
		await db.query(`delete from auth.users where id = $1`, [uploader]);

		const { rows } = await db.query(
			`select uploaded_by from selva.definition_versions where file_key = 'legacy/key.gh'`
		);
		expect(rows).toEqual([{ uploaded_by: null }]);
	});

	it('keeps a project in its org', async () => {
		const other = await seedOrg(db, await seedUser(db));
		const project = await seedProject(db, acme, owner);
		await expect(
			asRole(db, 'service_role', `update selva.projects set org_id = $1 where id = $2`, [
				other,
				project
			])
		).rejects.toThrow(/cannot move to another org/);
		await asRole(db, 'service_role', `update selva.projects set name = 'Renamed' where id = $1`, [
			project
		]);
	});

	it("frees a deleted org's slug and still refuses a live duplicate", async () => {
		const first = await seedOrg(db, owner);
		const { rows } = await db.query<{ slug: string }>(`select slug from selva.orgs where id = $1`, [
			first
		]);
		const insert = `insert into selva.orgs (id, name, slug, owner_id)
			values (gen_random_uuid(), 'Again', $1, $2)`;

		await expect(db.query(insert, [rows[0].slug, owner])).rejects.toThrow(/orgs_slug_key/);
		await db.query(`update selva.orgs set deleted_at = now() where id = $1`, [first]);
		await db.query(insert, [rows[0].slug, owner]);
	});
});

// The rules give instance_admin a bypass on management and none on content.
describe('instance_admin reads what it administers, not tenant content', () => {
	let staff: string;
	let project: string;
	let definition: string;
	let link: string;

	beforeAll(async () => {
		staff = await seedUser(db);
		await db.query(
			`update selva.user_profiles set platform_permissions = '{instance_admin}' where user_id = $1`,
			[staff]
		);
		project = await seedProject(db, acme, owner);
		await seedProjectMember(db, project, owner, 'owner');
		definition = await seedDefinition(db, project, owner);
		link = await seedShareLink(db, definition, owner);
	});

	const count = async (sql: string, params: unknown[]) =>
		(await actAs(db, { sub: staff }, sql, params)).length;

	it('hides a private project, its definitions and their versions', async () => {
		expect(await count(`select 1 from selva.projects where id = $1`, [project])).toBe(0);
		expect(await count(`select 1 from selva.definitions where guid = $1`, [definition])).toBe(0);
		expect(
			await count(`select 1 from selva.definition_versions where definition_guid = $1`, [
				definition
			])
		).toBe(0);
	});

	it('still shows the org, its roster, the project roster and the share-link roster', async () => {
		expect(await count(`select 1 from selva.share_links where id = $1`, [link])).toBe(1);
		expect(await count(`select 1 from selva.orgs where id = $1`, [acme])).toBe(1);
		expect(
			await count(`select 1 from selva.org_members where org_id = $1`, [acme])
		).toBeGreaterThan(0);
		expect(
			await count(`select 1 from selva.project_members where project_id = $1`, [project])
		).toBe(1);
	});

	it('still shows the owner their own project', async () => {
		expect(
			await actAs(db, { sub: owner }, `select 1 from selva.definitions where guid = $1`, [
				definition
			])
		).toHaveLength(1);
	});
});

describe('user_profiles', () => {
	const read = `select user_id from selva.user_profiles where user_id = $1`;

	it('hides a profile from someone who shares no org with it', async () => {
		const stranger = await seedUser(db);
		expect(await actAs(db, { sub: stranger }, read, [member])).toEqual([]);
	});

	it('shows your own profile and those of your org', async () => {
		expect(await actAs(db, { sub: member }, read, [member])).toHaveLength(1);
		expect(await actAs(db, { sub: member }, read, [owner])).toHaveLength(1);
	});

	it('stops showing a colleague once they leave', async () => {
		const leaver = await seedUser(db);
		await seedOrgMember(db, acme, leaver, 'member');
		await db.query(`update selva.org_members set deleted_at = now() where user_id = $1`, [leaver]);
		expect(await actAs(db, { sub: member }, read, [leaver])).toEqual([]);
	});
});

describe('delegated sessions stay in their token org', () => {
	const read = `select guid from selva.definitions where guid = $1`;
	let dual: string;
	let orgB: string;
	let definitionB: string;

	beforeAll(async () => {
		dual = await seedUser(db);
		orgB = await seedOrg(db, await seedUser(db));
		await seedOrgMember(db, acme, dual, 'admin', ['manage_org_members', 'manage_projects']);
		await seedOrgMember(db, orgB, dual, 'admin', ['manage_org_members', 'manage_projects']);
		const projectB = await seedProject(db, orgB, dual);
		await seedProjectMember(db, projectB, dual, 'owner');
		definitionB = await seedDefinition(db, projectB, dual);
	});

	it("hides another org's definition from a token for this one", async () => {
		expect(await actAs(db, { sub: dual, selva_org: acme }, read, [definitionB])).toEqual([]);
	});

	it('still reads inside its own org', async () => {
		expect(await actAs(db, { sub: dual, selva_org: orgB }, read, [definitionB])).toEqual([
			{ guid: definitionB }
		]);
	});
});

describe('remove_org_member', () => {
	const remove = `select selva.remove_org_member($1, $2, $3)`;

	it("ends the leaver's project memberships with the org membership, stamped with the remover", async () => {
		const leaver = await seedUser(db);
		await seedOrgMember(db, acme, leaver, 'member');
		const privateProject = await seedProject(db, acme, leaver);
		await seedProjectMember(db, privateProject, leaver, 'owner');

		await asRole(db, 'service_role', remove, [acme, leaver, admin]);

		const { rows } = await db.query<{ live: boolean; updated_by: string }>(
			`select deleted_at is null as live, updated_by from selva.project_members
			 where project_id = $1 and user_id = $2
			 union all
			 select deleted_at is null, updated_by from selva.org_members
			 where org_id = $3 and user_id = $2`,
			[privateProject, leaver, acme]
		);
		expect(rows).toEqual([
			{ live: false, updated_by: admin },
			{ live: false, updated_by: admin }
		]);
	});

	it('fails for someone who is not a member', async () => {
		const stranger = await seedUser(db);
		await expect(asRole(db, 'service_role', remove, [acme, stranger, admin])).rejects.toThrow(
			/not found/
		);
	});
});

describe('share-link roster', () => {
	const roster = `select * from selva.org_share_link_roster($1, 50, 0)`;

	it('shows leadership links on private projects they cannot open', async () => {
		const creator = await seedUser(db);
		await seedOrgMember(db, acme, creator, 'member');
		const hidden = await seedProject(db, acme, creator);
		await seedProjectMember(db, hidden, creator, 'owner');
		const guid = await seedDefinition(db, hidden, creator);
		const link = await seedShareLink(db, guid, creator);

		const rows = await actAs<{ id: string; total_count: string | number }>(
			db,
			{ sub: admin },
			roster,
			[acme]
		);

		expect(rows.map((r) => r.id)).toContain(link);
		expect(Number(rows[0].total_count)).toBe(rows.length);
	});

	it('leaves revoked links out', async () => {
		const creator = await seedUser(db);
		await seedOrgMember(db, acme, creator, 'member');
		const project = await seedProject(db, acme, creator);
		const guid = await seedDefinition(db, project, creator);
		const link = await seedShareLink(db, guid, creator);
		await db.query(`update selva.share_links set revoked_at = now() where id = $1`, [link]);

		const rows = await actAs<{ id: string }>(db, { sub: admin }, roster, [acme]);

		expect(rows.map((r) => r.id)).not.toContain(link);
	});

	it('refuses anyone without manage_org_members', async () => {
		await expect(actAs(db, { sub: member }, roster, [acme])).rejects.toThrow(/permission/);
	});
});
