import type { AuthUser, IAuthProvider } from '@selvajs/platform';

const PAGE_LIMIT = 200;
// Runaway guard against an adapter returning a non-advancing cursor.
// 100 pages = 20k users, far past any deployment this product targets.
const MAX_PAGES = 100;

/**
 * `IAuthProvider` has no by-email lookup and `listUsers` takes no filter, so
 * this scans. Acceptable because the only caller is invite acceptance — once
 * per invite, never on a hot path.
 *
 * A truncated scan would report an existing user as absent and send the flow
 * down the create-account branch, where the provider rejects the duplicate. So
 * exhausting the cursor matters: `null` must mean "not found", not "gave up".
 * Returns `null` when the provider has no user store (`listUsers` → null) or
 * when the cap is hit.
 */
export async function findAuthUserByEmail(
	auth: IAuthProvider,
	email: string
): Promise<AuthUser | null> {
	const needle = email.trim().toLowerCase();
	if (!needle) return null;

	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await auth.listUsers({ limit: PAGE_LIMIT, cursor });
		if (!result) return null;
		const hit = result.items.find((u) => u.email?.trim().toLowerCase() === needle);
		if (hit) return hit;
		cursor = result.nextCursor;
		if (!cursor) return null;
	}
	return null;
}
