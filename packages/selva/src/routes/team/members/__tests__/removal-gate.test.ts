import { describe, it, expect } from 'vitest';
import { removalBlockReason } from '../removal-gate';

const member = { userId: 'u-member', role: 'member' as const };
const admin = { userId: 'u-admin', role: 'admin' as const };
const owner = { userId: 'u-owner', role: 'owner' as const };

describe('removalBlockReason', () => {
	it('allows an owner to remove a plain member', () => {
		expect(
			removalBlockReason({
				target: member,
				actorUserId: owner.userId,
				actorRole: 'owner',
				ownerCount: 1
			})
		).toBeNull();
	});

	it('allows an admin to remove a plain member', () => {
		expect(
			removalBlockReason({
				target: member,
				actorUserId: admin.userId,
				actorRole: 'admin',
				ownerCount: 1
			})
		).toBeNull();
	});

	it('blocks self-removal', () => {
		expect(
			removalBlockReason({
				target: admin,
				actorUserId: admin.userId,
				actorRole: 'admin',
				ownerCount: 1
			})
		).toMatch(/yourself/);
	});

	// The org would be left unadministrable; the route returns 409.
	it('blocks removing the sole owner even for that owner', () => {
		expect(
			removalBlockReason({
				target: owner,
				actorUserId: 'someone-else',
				actorRole: 'owner',
				ownerCount: 1
			})
		).toMatch(/sole owner/);
	});

	// An admin got 403 on demoting an owner but would otherwise get 204 on the
	// strictly harder-to-reverse remove — the drift `canChangeOrgRole` centralized.
	it('blocks an admin from removing an owner', () => {
		expect(
			removalBlockReason({
				target: owner,
				actorUserId: admin.userId,
				actorRole: 'admin',
				ownerCount: 2
			})
		).toMatch(/Only the org owner/);
	});

	it('allows owner-on-owner removal when another owner remains', () => {
		expect(
			removalBlockReason({
				target: owner,
				actorUserId: 'other-owner',
				actorRole: 'owner',
				ownerCount: 2
			})
		).toBeNull();
	});

	it('blocks removal when the actor has no membership row', () => {
		expect(
			removalBlockReason({
				target: owner,
				actorUserId: 'stranger',
				actorRole: null,
				ownerCount: 2
			})
		).toMatch(/Only the org owner/);
	});
});
