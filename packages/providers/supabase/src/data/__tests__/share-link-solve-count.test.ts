/** The solve counter refuses what token resolution refuses: a link whose definition is soft-deleted. */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	asRole,
	migratedDb,
	seedDefinition,
	seedOrg,
	seedProject,
	seedShareLink,
	seedUser
} from './pglite-harness.js';

let db: PGlite;
let owner: string;
let project: string;

const countSolve = async (link: string) =>
	(
		await asRole<{ n: number | null }>(
			db,
			'service_role',
			`select selva.try_increment_share_link_solve_count($1) as n`,
			[link]
		)
	)[0].n;

beforeAll(async () => {
	db = await migratedDb();
	owner = await seedUser(db);
	project = await seedProject(db, await seedOrg(db, owner), owner);
});

describe('try_increment_share_link_solve_count', () => {
	it('counts a solve on a live definition', async () => {
		const link = await seedShareLink(db, await seedDefinition(db, project, owner), owner);
		expect(await countSolve(link)).toBe(1);
	});

	it('refuses once the definition is soft-deleted, and leaves the count alone', async () => {
		const definition = await seedDefinition(db, project, owner);
		const link = await seedShareLink(db, definition, owner);
		await db.query(`update selva.definitions set deleted_at = now() where guid = $1`, [definition]);

		expect(await countSolve(link)).toBeNull();
		const { rows } = await db.query<{ solve_count: number }>(
			`select solve_count from selva.share_links where id = $1`,
			[link]
		);
		expect(rows[0].solve_count).toBe(0);
	});
});
