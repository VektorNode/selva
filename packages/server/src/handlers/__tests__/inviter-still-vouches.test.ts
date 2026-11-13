/**
 * An invite is only as good as the person who sent it: once they are disabled,
 * out of the org, or no longer able to send it, the invite stops working.
 */

import { describe, it, expect } from 'vitest';
import type { AuthUser, Invite, OrgMember, PlatformPermission } from '@selvajs/platform';
import { inviterStillVouches } from '../invites.js';

const memberInvite = { orgId: 'org-a', invitedBy: 'leaver', orgRole: 'member' } as Invite;
const ownerInvite = { ...memberInvite, orgRole: 'owner' } as Invite;
const staffInvite = { ...memberInvite, platformPermissions: ['instance_admin'] } as Invite;

const owner = { role: 'owner', permissions: ['manage_org_members'] } as OrgMember;
const admin = { role: 'admin', permissions: ['manage_org_members'] } as OrgMember;
const plain = { role: 'member', permissions: [] as string[] } as OrgMember;

function deps(user: Partial<AuthUser> | null, member: OrgMember | null, platform: string[] = []) {
	return {
		auth: { getUser: async () => (user ? ({ id: 'leaver', ...user } as AuthUser) : null) },
		orgs: { getOrgMember: async () => member },
		permissions: { getFor: async () => platform as PlatformPermission[] }
	};
}

describe('inviterStillVouches', () => {
	it('holds while the inviter is enabled and still manages members', async () => {
		expect(await inviterStillVouches(memberInvite, deps({}, admin))).toBe(true);
		expect(await inviterStillVouches(ownerInvite, deps({}, owner))).toBe(true);
	});

	it('fails once the inviter is disabled', async () => {
		expect(await inviterStillVouches(memberInvite, deps({ disabled: true }, admin))).toBe(false);
	});

	it('fails once the inviter has left the org or been deleted', async () => {
		expect(await inviterStillVouches(memberInvite, deps({}, null))).toBe(false);
		expect(await inviterStillVouches(memberInvite, deps(null, admin))).toBe(false);
	});

	it('holds for an instance admin who invites into an org they are not in', async () => {
		expect(await inviterStillVouches(memberInvite, deps({}, null, ['instance_admin']))).toBe(true);
	});

	it('fails once the inviter is demoted below what the invite hands out', async () => {
		// The parked-authority case: mint an owner invite, get demoted, accept it.
		expect(await inviterStillVouches(ownerInvite, deps({}, admin))).toBe(false);
		expect(await inviterStillVouches(ownerInvite, deps({}, plain))).toBe(false);
		expect(await inviterStillVouches(memberInvite, deps({}, plain))).toBe(false);
	});

	it('fails for platform permissions once the inviter is no longer instance admin', async () => {
		expect(await inviterStillVouches(staffInvite, deps({}, owner))).toBe(false);
		expect(await inviterStillVouches(staffInvite, deps({}, owner, ['instance_admin']))).toBe(true);
	});

	it('gives an instance admin no pass on the owner boundary', async () => {
		expect(await inviterStillVouches(ownerInvite, deps({}, null, ['instance_admin']))).toBe(false);
	});
});
