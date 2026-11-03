/**
 * An invite is only as good as the person who sent it: once they are
 * disabled or out of the org, the invites they sent stop working.
 */

import { describe, it, expect } from 'vitest';
import type { AuthUser, Invite, OrgMember, PlatformPermission } from '@selvajs/platform';
import { inviterStillVouches } from '../invites.js';

const invite = { orgId: 'org-a', invitedBy: 'leaver' } as Invite;

function deps(user: Partial<AuthUser> | null, member: boolean, platform: string[] = []) {
	return {
		auth: { getUser: async () => (user ? ({ id: 'leaver', ...user } as AuthUser) : null) },
		orgs: { getOrgMember: async () => (member ? ({ role: 'admin' } as OrgMember) : null) },
		permissions: { getFor: async () => platform as PlatformPermission[] }
	};
}

describe('inviterStillVouches', () => {
	it('holds while the inviter is enabled and still a member', async () => {
		expect(await inviterStillVouches(invite, deps({}, true))).toBe(true);
	});

	it('fails once the inviter is disabled', async () => {
		expect(await inviterStillVouches(invite, deps({ disabled: true }, true))).toBe(false);
	});

	it('fails once the inviter has left the org or been deleted', async () => {
		expect(await inviterStillVouches(invite, deps({}, false))).toBe(false);
		expect(await inviterStillVouches(invite, deps(null, true))).toBe(false);
	});

	it('holds for an instance admin who invites into an org they are not in', async () => {
		expect(await inviterStillVouches(invite, deps({}, false, ['instance_admin']))).toBe(true);
	});
});
