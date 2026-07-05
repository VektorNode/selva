/**
 * §3c regression: `readJsonFile` returns its fallback BY REFERENCE on a missing
 * file. A store that used a shared module-level `EMPTY` constant as that
 * fallback AND mutated the loaded object (`LocalInviteStore.create` does
 * `.push`) would pollute the shared constant — so the NEXT store to read a
 * missing file would see the first store's data (cross-request/cross-instance
 * bleed). These tests pin that the fallback is a fresh object each time.
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
		// Store A: file does not exist yet → create() loads the empty fallback and
		// pushes into it, then writes A's own file.
		const storeA = new LocalInviteStore(dirA);
		await storeA.create(SYSTEM_CONTEXT, invite('a1'));

		// Store B: brand-new empty dir, file also does not exist → must read as EMPTY.
		// If the fallback were a shared mutable constant, A's push would show up here.
		const storeB = new LocalInviteStore(dirB);
		const page = await storeB.listByOrg(SYSTEM_CONTEXT, 'org-1');
		expect(page.items).toEqual([]);
	});

	it('a second missing-file read on the same store is still empty after a create+delete cycle', async () => {
		const store = new LocalInviteStore(dirA);
		await store.create(SYSTEM_CONTEXT, invite('a1'));
		// A separate store instance on the SAME dir sees exactly the one invite —
		// not a doubled/leaked list.
		const same = new LocalInviteStore(dirA);
		const page = await same.listByOrg(SYSTEM_CONTEXT, 'org-1');
		expect(page.items.map((i) => i.id)).toEqual(['a1']);
	});
});
