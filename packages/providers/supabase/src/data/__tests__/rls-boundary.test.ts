/**
 * RLS against the rules in `access/rules.ts`, replayed as direct REST calls. The
 * anon key is publishable, so a signed-in user can skip Selva and reach
 * PostgREST with their own JWT: these policies are the boundary, not a backstop.
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

async function seedInvite(orgRole = 'member'): Promise<string> {
	const id = crypto.randomUUID();
	await db.query(
		`insert into selva.invites (id, token_hash, email, org_id, org_role, org_permissions, invited_by, expires_at)
		 values ($1, $2, 'alt@evil.io', $3, $4, '{}', $5, now() + interval '7 days')`,
		[id, `hash-${id}`, acme, orgRole, admin]
	);
	return id;
}

const INVITE_INSERT = `insert into selva.invites
	(id, token_hash, email, org_id, org_role, org_permissions, platform_permissions, invited_by, expires_at)
	values (gen_random_uuid(), gen_random_uuid()::text, 'x@evil.io', $1, $2, '{}', $3, $4, now() + interval '7 days')
	returning id`;

describe('invites', () => {
	it('refuses rewriting a pending invite to carry instance_admin', async () => {
		const invite = await seedInvite();
		await expect(
			actAs(
				db,
				{ sub: admin },
				`update selva.invites set platform_permissions = '{instance_admin}', org_role = 'owner' where id = $1`,
				[invite]
			)
		).rejects.toThrow(/permission denied/);
	});

	it('refuses minting an invite with platform permissions', async () => {
		await expect(
			actAs(db, { sub: admin }, INVITE_INSERT, [acme, 'member', ['instance_admin'], admin])
		).rejects.toThrow(/row-level security/);
	});

	it('refuses an admin minting an owner invite, which only an owner may do', async () => {
		await expect(
			actAs(db, { sub: admin }, INVITE_INSERT, [acme, 'owner', [], admin])
		).rejects.toThrow(/row-level security/);
		const rows = await actAs(db, { sub: owner }, INVITE_INSERT, [acme, 'owner', [], owner]);
		expect(rows).toHaveLength(1);
	});

	it('lets an admin mint a member invite', async () => {
		const rows = await actAs(db, { sub: admin }, INVITE_INSERT, [acme, 'member', [], admin]);
		expect(rows).toHaveLength(1);
	});
});

describe('org_members mirrors canChangeOrgRole', () => {
	it('refuses an admin promoting themselves to owner', async () => {
		await expect(
			actAs(
				db,
				{ sub: admin },
				`update selva.org_members set role = 'owner' where org_id = $1 and user_id = $2`,
				[acme, admin]
			)
		).resolves.toEqual([]);
		const { rows } = await db.query<{ role: string }>(
			`select role from selva.org_members where org_id = $1 and user_id = $2`,
			[acme, admin]
		);
		expect(rows[0].role).toBe('admin');
	});

	it('refuses an admin demoting an owner', async () => {
		await actAs(
			db,
			{ sub: admin },
			`update selva.org_members set role = 'member' where org_id = $1 and user_id = $2`,
			[acme, owner]
		);
		const { rows } = await db.query<{ role: string }>(
			`select role from selva.org_members where org_id = $1 and user_id = $2`,
			[acme, owner]
		);
		expect(rows[0].role).toBe('owner');
	});

	it('refuses an admin promoting a member to owner', async () => {
		await expect(
			actAs(
				db,
				{ sub: admin },
				`update selva.org_members set role = 'owner' where org_id = $1 and user_id = $2`,
				[acme, member]
			)
		).rejects.toThrow(/row-level security/);
	});

	it('lets an owner promote a member', async () => {
		const target = await seedUser(db);
		await seedOrgMember(db, acme, target, 'member');
		const rows = await actAs(
			db,
			{ sub: owner },
			`update selva.org_members set role = 'admin' where org_id = $1 and user_id = $2 returning role`,
			[acme, target]
		);
		expect(rows).toEqual([{ role: 'admin' }]);
	});
});

describe('departed members', () => {
	async function leave(userId: string): Promise<void> {
		await db.query(
			`update selva.org_members set deleted_at = now() where org_id = $1 and user_id = $2`,
			[acme, userId]
		);
		await db.query(`update selva.project_members set deleted_at = now() where user_id = $1`, [
			userId
		]);
	}

	it('refuses a removed creator reactivating their owner row', async () => {
		const creator = await seedUser(db);
		await seedOrgMember(db, acme, creator, 'member');
		const project = await seedProject(db, acme, creator);
		await seedProjectMember(db, project, creator, 'owner');
		await leave(creator);

		const rows = await actAs(
			db,
			{ sub: creator },
			`update selva.project_members set deleted_at = null
			 where project_id = $1 and user_id = $2 returning user_id`,
			[project, creator]
		);

		expect(rows).toEqual([]);
	});

	it('refuses a departed commons uploader editing their definition', async () => {
		const uploader = await seedUser(db);
		await seedOrgMember(db, acme, uploader, 'member');
		const project = await seedProject(db, acme, owner, { visibility: 'public', commons: true });
		const guid = await seedDefinition(db, project, uploader);
		await leave(uploader);

		const rows = await actAs(
			db,
			{ sub: uploader },
			`update selva.definitions set display_name = 'after' where guid = $1 returning guid`,
			[guid]
		);

		expect(rows).toEqual([]);
	});

	it('refuses a departed commons uploader minting a share link', async () => {
		const uploader = await seedUser(db);
		await seedOrgMember(db, acme, uploader, 'member');
		const project = await seedProject(db, acme, owner, { visibility: 'public', commons: true });
		const guid = await seedDefinition(db, project, uploader);
		await leave(uploader);

		await expect(
			actAs(
				db,
				{ sub: uploader },
				`insert into selva.share_links (id, definition_guid, token_hash, channel, created_by)
				 values (gen_random_uuid(), $1, 'h', 'live', $2)`,
				[guid, uploader]
			)
		).rejects.toThrow(/row-level security/);
	});

	it('still lets a current commons uploader edit their definition', async () => {
		const uploader = await seedUser(db);
		await seedOrgMember(db, acme, uploader, 'member');
		const project = await seedProject(db, acme, owner, { visibility: 'public', commons: true });
		const guid = await seedDefinition(db, project, uploader);

		const rows = await actAs(
			db,
			{ sub: uploader },
			`update selva.definitions set display_name = 'after' where guid = $1 returning guid`,
			[guid]
		);

		expect(rows).toEqual([{ guid }]);
	});

	it('lets an outsider finish a first upload to a public commons, then stops', async () => {
		const outsider = await seedUser(db);
		const project = await seedProject(db, acme, owner, { visibility: 'public', commons: true });
		const [{ guid }] = await actAs<{ guid: string }>(
			db,
			{ sub: outsider },
			`insert into selva.definitions (guid, project_id, owner_id, display_name, status)
			 values (gen_random_uuid(), $1, $2, 'D', 'pending') returning guid`,
			[project, outsider]
		);
		const [{ id }] = await actAs<{ id: string }>(
			db,
			{ sub: outsider },
			`insert into selva.definition_versions
				(id, definition_guid, version_number, file_ext, file_key, original_filename, uploaded_by)
			 values (gen_random_uuid(), $1, 1, 'gh', 'k', 'd.gh', $2) returning id`,
			[guid, outsider]
		);

		const attach = `update selva.definitions set live_version_id = $1, status = 'published'
			where guid = $2 returning guid`;
		expect(await actAs(db, { sub: outsider }, attach, [id, guid])).toEqual([{ guid }]);

		const edit = `update selva.definitions set display_name = 'later' where guid = $1 returning guid`;
		expect(await actAs(db, { sub: outsider }, edit, [guid])).toEqual([]);
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
	let dual: string;
	let orgB: string;
	let projectB: string;
	let definitionB: string;

	beforeAll(async () => {
		dual = await seedUser(db);
		const bOwner = await seedUser(db);
		orgB = await seedOrg(db, bOwner);
		await seedOrgMember(db, acme, dual, 'admin', ['manage_org_members', 'manage_projects']);
		await seedOrgMember(db, orgB, dual, 'admin', ['manage_org_members', 'manage_projects']);
		projectB = await seedProject(db, orgB, dual);
		await seedProjectMember(db, projectB, dual, 'owner');
		definitionB = await seedDefinition(db, projectB, dual);
	});

	it('refuses writing a definition in another org', async () => {
		const rows = await actAs(
			db,
			{ sub: dual, selva_org: acme },
			`update selva.definitions set display_name = 'x' where guid = $1 returning guid`,
			[definitionB]
		);
		expect(rows).toEqual([]);
	});

	it('refuses writing a member row in another org', async () => {
		const rows = await actAs(
			db,
			{ sub: dual, selva_org: acme },
			`update selva.org_members set permissions = '{}' where org_id = $1 returning user_id`,
			[orgB]
		);
		expect(rows).toEqual([]);
	});

	it('refuses creating a project in another org', async () => {
		await expect(
			actAs(
				db,
				{ sub: dual, selva_org: acme },
				`insert into selva.projects (id, org_id, owner_id, name, slug)
				 values (gen_random_uuid(), $1, $2, 'P', 'nope')`,
				[orgB, dual]
			)
		).rejects.toThrow(/row-level security/);
	});

	it('refuses creating a share link in another org', async () => {
		await expect(
			actAs(
				db,
				{ sub: dual, selva_org: acme },
				`insert into selva.share_links (id, definition_guid, token_hash, channel, created_by)
				 values (gen_random_uuid(), $1, 'h2', 'live', $2)`,
				[definitionB, dual]
			)
		).rejects.toThrow(/row-level security/);
	});

	it('refuses creating an org at all', async () => {
		await expect(
			actAs(
				db,
				{ sub: dual, selva_org: acme },
				`insert into selva.orgs (id, name, slug, owner_id) values (gen_random_uuid(), 'X', 'x-org', $1)`,
				[dual]
			)
		).rejects.toThrow(/row-level security/);
	});

	it('still writes inside its own org', async () => {
		const rows = await actAs(
			db,
			{ sub: dual, selva_org: orgB },
			`update selva.definitions set display_name = 'x' where guid = $1 returning guid`,
			[definitionB]
		);
		expect(rows).toEqual([{ guid: definitionB }]);
	});
});

describe('remove_org_member (H2)', () => {
	const remove = `select selva.remove_org_member($1, $2)`;

	it('ends project access the acting admin cannot see', async () => {
		const leaver = await seedUser(db);
		await seedOrgMember(db, acme, leaver, 'member');
		const privateProject = await seedProject(db, acme, leaver);
		await seedProjectMember(db, privateProject, leaver, 'owner');
		const guid = await seedDefinition(db, privateProject, leaver);

		await actAs(db, { sub: admin }, remove, [acme, leaver]);

		const edit = `update selva.definitions set display_name = 'after' where guid = $1 returning guid`;
		expect(await actAs(db, { sub: leaver }, edit, [guid])).toEqual([]);
		const { rows } = await db.query(
			`select 1 from selva.project_members where project_id = $1 and deleted_at is null`,
			[privateProject]
		);
		expect(rows).toEqual([]);
	});

	it('fails for someone who is not a member', async () => {
		const stranger = await seedUser(db);
		await expect(actAs(db, { sub: admin }, remove, [acme, stranger])).rejects.toThrow(/not found/);
	});

	it('refuses an admin removing an owner', async () => {
		await expect(actAs(db, { sub: admin }, remove, [acme, owner])).rejects.toThrow(/permission/);
	});

	it('refuses a plain member', async () => {
		const victim = await seedUser(db);
		await seedOrgMember(db, acme, victim, 'member');
		await expect(actAs(db, { sub: member }, remove, [acme, victim])).rejects.toThrow(/permission/);
	});

	it('runs for the service role', async () => {
		const victim = await seedUser(db);
		await seedOrgMember(db, acme, victim, 'member');
		await asRole(db, 'service_role', remove, [acme, victim]);
		const { rows } = await db.query(
			`select 1 from selva.org_members where user_id = $1 and deleted_at is null`,
			[victim]
		);
		expect(rows).toEqual([]);
	});
});

describe('share-link roster and revoke (M2)', () => {
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

	it('lets a commons uploader revoke their own link', async () => {
		const uploader = await seedUser(db);
		await seedOrgMember(db, acme, uploader, 'member');
		const project = await seedProject(db, acme, owner, { visibility: 'public', commons: true });
		const guid = await seedDefinition(db, project, uploader);
		const link = await seedShareLink(db, guid, uploader);

		const rows = await actAs(
			db,
			{ sub: uploader },
			`update selva.share_links set revoked_at = now() where id = $1 returning id`,
			[link]
		);

		expect(rows).toEqual([{ id: link }]);
	});
});
