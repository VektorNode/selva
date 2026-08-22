import type { ILogger, IOrgStore, OrgMember } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

const PAGE_LIMIT = 200;
// Runaway guard against an adapter that returns a non-advancing cursor —
// 100 pages = 20k members, far past any real org on this product.
const MAX_PAGES = 100;

/**
 * Drain every membership page for an org. The admin users pages merge
 * per-user org permissions into these rows; a truncated list would render
 * those users as permissionless, and the permission-toggle UI builds its
 * PATCH payload from the displayed state — so truncation here could silently
 * wipe a user's org permissions on the next edit.
 */
export async function listAllOrgMembers(
	orgs: IOrgStore,
	orgId: string,
	log?: ILogger
): Promise<OrgMember[]> {
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
	// Injected rather than resolved: hitting the cap is the one outcome a caller
	// must be able to see, and a package that reached for a host's logger could
	// not be used by a host that has a different one.
	log?.warn('listAllOrgMembers hit the page cap — member list may be incomplete', {
		component: 'admin',
		orgId,
		pages: MAX_PAGES
	});
	return members;
}
