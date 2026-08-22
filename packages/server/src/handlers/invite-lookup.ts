import type { IDataProvider, Invite, RequestContext } from '@selvajs/platform';

/**
 * Find an invite by id, confirming it belongs to `orgId`.
 *
 * `manage_org_members` is org-scoped, so a permitted caller must not reach an
 * invite in another org. Neither store scopes `revoke()` by acting org, so
 * every route that mutates an invite by id has to establish ownership first —
 * hence one shared paged scan rather than a copy per route.
 */
export async function findPendingInviteInOrg(
	ctx: RequestContext,
	orgId: string,
	id: string,
	store: IDataProvider['invites']
): Promise<Invite | null> {
	let cursor: string | undefined;
	do {
		const page = await store.listByOrg(ctx, orgId, { limit: 200, cursor });
		const match = page.items.find((i) => i.id === id);
		if (match) return match;
		cursor = page.nextCursor ?? undefined;
	} while (cursor);
	return null;
}
