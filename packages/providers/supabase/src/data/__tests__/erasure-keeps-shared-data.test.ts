/** Deleting an auth user removes that person, not the tenant data they once created. */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	migratedDb,
	seedDefinition,
	seedOrg,
	seedOrgMember,
	seedProject,
	seedProjectMember,
	seedUser
} from './pglite-harness.js';

let db: PGlite;

beforeAll(async () => {
	db = await migratedDb();
});

async function count(table: string, column: string, value: string): Promise<number> {
	const { rows } = await db.query<{ n: number }>(
		`select count(*)::int as n from selva.${table} where ${column} = $1`,
		[value]
	);
	return rows[0].n;
}

const erase = (user: string) => db.query(`delete from auth.users where id = $1`, [user]);

describe('erasing a user', () => {
	it('keeps an org, and everything in it, that its founder left behind', async () => {
		const founder = await seedUser(db);
		const colleague = await seedUser(db);
		const acme = await seedOrg(db, founder);
		await seedOrgMember(db, acme, colleague, 'owner');
		const project = await seedProject(db, acme, colleague);
		const guid = await seedDefinition(db, project, colleague);
		await db.query(
			`update selva.org_members set deleted_at = now() where org_id = $1 and user_id = $2`,
			[acme, founder]
		);

		await erase(founder);

		expect(await count('orgs', 'id', acme)).toBe(1);
		expect(await count('projects', 'id', project)).toBe(1);
		expect(await count('definitions', 'guid', guid)).toBe(1);
		expect(await count('org_members', 'user_id', colleague)).toBe(1);
		const { rows } = await db.query<{ owner_id: string | null }>(
			`select owner_id from selva.orgs where id = $1`,
			[acme]
		);
		expect(rows[0].owner_id).toBeNull();
	});

	it('keeps a shared project when its creator goes', async () => {
		const creator = await seedUser(db);
		const colleague = await seedUser(db);
		const org = await seedOrg(db, colleague);
		await seedOrgMember(db, org, creator, 'member');
		const project = await seedProject(db, org, creator);
		await seedProjectMember(db, project, colleague, 'owner');
		const guid = await seedDefinition(db, project, creator);

		await erase(creator);

		expect(await count('projects', 'id', project)).toBe(1);
		expect(await count('definitions', 'guid', guid)).toBe(1);
	});

	it("can erase the uploader of someone else's live version", async () => {
		const owner = await seedUser(db);
		const uploader = await seedUser(db);
		const org = await seedOrg(db, owner);
		const project = await seedProject(db, org, owner);
		const guid = await seedDefinition(db, project, owner);
		await db.query(
			`update selva.definition_versions set uploaded_by = $1 where definition_guid = $2`,
			[uploader, guid]
		);

		await erase(uploader);

		expect(await count('definition_versions', 'definition_guid', guid)).toBe(1);
	});

	it('still ends their memberships and tokens', async () => {
		const owner = await seedUser(db);
		const leaver = await seedUser(db);
		const org = await seedOrg(db, owner);
		await seedOrgMember(db, org, leaver, 'member');

		await erase(leaver);

		expect(await count('org_members', 'user_id', leaver)).toBe(0);
	});
});
