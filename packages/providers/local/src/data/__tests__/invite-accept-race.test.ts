import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SYSTEM_CONTEXT, type Invite } from '@selvajs/platform';
import { LocalInviteStore } from '../LocalInviteStore.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-invite-race-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

const invite = (expiresInMs: number) =>
	({
		id: 'i',
		tokenHash: 'h',
		email: 'new@acme.test',
		orgId: 'acme',
		orgRole: 'member',
		orgPermissions: [],
		invitedBy: 'a',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
		acceptedAt: null,
		acceptedByUserId: null
	}) as unknown as Invite;

describe('markAccepted under a double submit', () => {
	it('accepts once and keeps the first acceptor', async () => {
		const emit = vi.fn(async () => {});
		const store = new LocalInviteStore(dir, { emit });
		await store.create(SYSTEM_CONTEXT, invite(60_000));
		emit.mockClear();

		const claimed = await Promise.all([
			store.markAccepted(SYSTEM_CONTEXT, 'i', 'first'),
			store.markAccepted(SYSTEM_CONTEXT, 'i', 'second')
		]);

		expect(claimed).toEqual([true, false]);
		expect(emit).toHaveBeenCalledOnce();
		const { invites } = JSON.parse(await fs.readFile(path.join(dir, 'invites.json'), 'utf8'));
		expect(invites[0].acceptedByUserId).toBe('first');
	});
});

// `getByTokenHash` hides an expired invite, so only a claim that read it just
// before the deadline gets here.
describe('markAccepted after the invite expired', () => {
	it('refuses the claim', async () => {
		const emit = vi.fn(async () => {});
		const store = new LocalInviteStore(dir, { emit });
		await store.create(SYSTEM_CONTEXT, invite(-1));
		emit.mockClear();

		expect(await store.markAccepted(SYSTEM_CONTEXT, 'i', 'late')).toBe(false);
		expect(emit).not.toHaveBeenCalled();
		const { invites } = JSON.parse(await fs.readFile(path.join(dir, 'invites.json'), 'utf8'));
		expect(invites[0].acceptedAt).toBeNull();
	});
});
