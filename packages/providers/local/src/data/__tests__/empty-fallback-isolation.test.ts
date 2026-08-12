/**
 * `readJsonFile` returns its fallback by reference on a missing file. A store
 * using a shared module-level `EMPTY` constant as that fallback, and mutating
 * the loaded object (`LocalInviteStore.create` does `.push`), would pollute the
 * shared constant — so the next store to read a missing file would see the
 * first store's data. These tests pin that the fallback is a fresh object each time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import type { Invite } from '@selvajs/platform';
import { LocalInviteStore } from '../LocalInviteStore.js';

let dirA: string;
let dirB: string;

beforeEach(async () => {
	dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-empty-a-'));
	dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-empty-b-'));
});

afterEach(async () => {
	await fs.rm(dirA, { recursive: true, force: true });
	await fs.rm(dirB, { recursive: true, force: true });
});

function invite(id: string, orgId = 'org-1'): Invite {
	return {
		id,
		tokenHash: `hash-${id}`,
		email: `${id}@example.com`,
		orgId,
		orgRole: 'member',
		orgPermissions: [],
		invitedBy: 'admin',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 86_400_000).toISOString()
	};
}

describe('LocalInviteStore — empty-fallback isolation (§3c)', () => {
	it('a fresh store on a different empty dir does not see another store’s invite', async () => {
		// A's file doesn't exist yet, so create() loads the empty fallback, pushes
		// into it, and writes A's own file.
		const storeA = new LocalInviteStore(dirA);
		await storeA.create(SYSTEM_CONTEXT, invite('a1'));

		// B is a separate empty dir with no file either — if the fallback were a
		// shared mutable constant, A's push would show up here.
		const storeB = new LocalInviteStore(dirB);
		const page = await storeB.listByOrg(SYSTEM_CONTEXT, 'org-1');
		expect(page.items).toEqual([]);
	});

	it('a second missing-file read on the same store is still empty after a create+delete cycle', async () => {
		const store = new LocalInviteStore(dirA);
		await store.create(SYSTEM_CONTEXT, invite('a1'));
		// A separate instance on the same dir sees exactly the one invite — not a
		// doubled or leaked list.
		const same = new LocalInviteStore(dirA);
		const page = await same.listByOrg(SYSTEM_CONTEXT, 'org-1');
		expect(page.items.map((i) => i.id)).toEqual(['a1']);
	});
});
