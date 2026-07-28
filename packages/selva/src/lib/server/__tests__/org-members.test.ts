import { describe, expect, it, vi } from 'vitest';
import type { IOrgStore, OrgMember, ListOptions } from '@selvajs/platform';
import { listAllOrgMembers } from '../org-members.server.js';

function member(userId: string): OrgMember {
	const now = new Date().toISOString();
	return {
		orgId: 'org-1',
		userId,
		role: 'member',
		permissions: [],
		joinedAt: now,
		updatedAt: now,
		updatedBy: userId,
		deletedAt: null
	};
}

/** Stub store that pages an in-memory member list with offset cursors. */
function stubOrgStore(members: OrgMember[]): IOrgStore {
	return {
		async listOrgMembers(_ctx: unknown, _orgId: string, opts?: ListOptions) {
			const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
			const items = members.slice(offset, offset + (opts?.limit ?? 25));
			const next = offset + items.length;
			return { items, nextCursor: next < members.length ? String(next) : undefined };
		}
	} as unknown as IOrgStore;
}

describe('listAllOrgMembers', () => {
	it('drains every page, not just the first 200', async () => {
		const members = Array.from({ length: 450 }, (_, i) => member(`user-${i}`));
		const all = await listAllOrgMembers(stubOrgStore(members), 'org-1');
		expect(all).toHaveLength(450);
		expect(all[449].userId).toBe('user-449');
	});

	it('returns a single short page without a second round-trip', async () => {
		const store = stubOrgStore([member('only')]);
		const spy = vi.spyOn(store, 'listOrgMembers');
		const all = await listAllOrgMembers(store, 'org-1');
		expect(all).toHaveLength(1);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('stops on a non-advancing cursor instead of looping forever', async () => {
		const broken = {
			async listOrgMembers() {
				return { items: [member('stuck')], nextCursor: 'same-cursor-every-time' };
			}
		} as unknown as IOrgStore;
		// The bail-out warns through the structured logger (not console), so spy
		// on the logger the provider mock hands out.
		const { getLogger } = await import('$lib/server/providers.server');
		const warn = vi.spyOn(getLogger(), 'warn').mockImplementation(() => {});

		const all = await listAllOrgMembers(broken, 'org-1');

		expect(all).toHaveLength(100); // MAX_PAGES iterations, then bail
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});
