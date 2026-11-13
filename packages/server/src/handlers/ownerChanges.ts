import type { IAuthProvider, IDataProvider, RequestContext } from '@selvajs/platform';

const ownerChangeQueues = new Map<string, Promise<unknown>>();

/**
 * Runs one org's or project's member changes one at a time. The sole-owner check
 * reads, then writes: two owners acting on each other at once would each see the
 * other as the survivor and leave none. Per process only; replicas still need an
 * atomic store write to close it.
 */
export function serializeOwnerChanges<T>(id: string, run: () => Promise<T>): Promise<T> {
	const previous = ownerChangeQueues.get(id) ?? Promise.resolve();
	const next = previous.catch(() => {}).then(run);
	const tail = next.catch(() => {});
	ownerChangeQueues.set(id, tail);
	void tail.then(() => {
		if (ownerChangeQueues.get(id) === tail) ownerChangeQueues.delete(id);
	});
	return next;
}

const ROSTER_PAGE_LIMIT = 200;
// Runaway guard against an adapter returning a non-advancing cursor. 100 pages
// is 20k members, past any real org here.
const MAX_ROSTER_PAGES = 100;

/**
 * Whether anyone other than `exceptUserId` owns the org and can still sign in.
 * A disabled owner is no survivor: nothing re-enables a user, so an org whose
 * only owner is disabled has nobody left who can name another.
 *
 * Pages the whole roster: a second owner past the first page otherwise reads as
 * none. Hitting the page cap reports `false`, so the caller refuses.
 */
export async function orgHasAnotherOwner(
	deps: { orgs: IDataProvider['orgs']; auth: IAuthProvider },
	ctx: RequestContext,
	orgId: string,
	exceptUserId: string
): Promise<boolean> {
	let cursor: string | undefined;
	for (let page = 0; page < MAX_ROSTER_PAGES; page++) {
		const result = await deps.orgs.listOrgMembers(ctx, orgId, { limit: ROSTER_PAGE_LIMIT, cursor });
		for (const m of result.items) {
			if (m.role !== 'owner' || m.userId === exceptUserId || m.deletedAt) continue;
			const user = await deps.auth.getUser(m.userId);
			if (user && !user.disabled) return true;
		}
		cursor = result.nextCursor;
		if (!cursor) return false;
	}
	return false;
}
