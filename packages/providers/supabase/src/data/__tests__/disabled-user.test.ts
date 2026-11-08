/**
 * Disabling a user on the database side: the flag a user cannot write, the profile copy every
 * check reads, and the pre-request hook that refuses a disabled caller's still-valid token.
 * Runs on PGlite, without a live stack.
 */

import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { actAs, migratedDb, seedUser } from './pglite-harness.js';

describe('a disabled user', () => {
	let db: PGlite;

	beforeAll(async () => {
		db = await migratedDb();
	});

	const disabledOf = async (id: string) =>
		(
			await db.query<{ disabled: boolean }>(
				'select disabled from selva.user_profiles where user_id = $1',
				[id]
			)
		).rows[0]?.disabled;

	it('follows app_metadata and the ban, never user_metadata', async () => {
		const id = await seedUser(db);
		await db.query(
			`update auth.users set raw_user_meta_data = '{"disabled": true}' where id = $1`,
			[id]
		);
		expect(await disabledOf(id)).toBe(false);

		await db.query(`update auth.users set raw_app_meta_data = '{"disabled": true}' where id = $1`, [
			id
		]);
		expect(await disabledOf(id)).toBe(true);

		await db.query(
			`update auth.users set raw_app_meta_data = '{}', banned_until = now() + interval '1 day'
			where id = $1`,
			[id]
		);
		expect(await disabledOf(id)).toBe(true);

		await db.query('update auth.users set banned_until = null where id = $1', [id]);
		expect(await disabledOf(id)).toBe(false);
	});

	it('gets every request refused by the pre-request hook, and an enabled user does not', async () => {
		const [enabled, disabled] = [await seedUser(db), await seedUser(db)];
		await db.query(`update auth.users set raw_app_meta_data = '{"disabled": true}' where id = $1`, [
			disabled
		]);

		await expect(
			actAs(db, { sub: enabled }, 'select selva.refuse_disabled_caller()')
		).resolves.toBeDefined();
		await expect(
			actAs(db, { sub: disabled }, 'select selva.refuse_disabled_caller()')
		).rejects.toMatchObject({ code: '42501' });
	});
});
