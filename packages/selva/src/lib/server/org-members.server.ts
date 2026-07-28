import type { IOrgStore, OrgMember } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { getLogger } from './providers.server.js';

const PAGE_LIMIT = 200;
// Runaway guard against an adapter that returns a non-advancing cursor —
// 100 pages = 20k members, far past any real org on this product.
const MAX_PAGES = 100;

/**
 * Drain every membership page for an org. The admin user surfaces merge
 * per-user org permissions into their rows; a truncated member list would
 * render those users as permissionless, and the permission-toggle UI builds
 * its PATCH payload from the displayed state — so truncation here could
 * silently wipe a user's org permissions on the next edit.
 */
export async function listAllOrgMembers(orgs: IOrgStore, orgId: string): Promise<OrgMember[]> {
	const members: OrgMember[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await orgs.listOrgMembers(SYSTEM_CONTEXT, orgId, {
			limit: PAGE_LIMIT,
			cursor
		});
		members.push(...result.items);
		cursor = result.nextCursor;
		if (!cursor) return members;
	}
	getLogger().warn('listAllOrgMembers hit the page cap — member list may be incomplete', {
		component: 'admin',
		orgId,
		pages: MAX_PAGES
	});
	return members;
}
