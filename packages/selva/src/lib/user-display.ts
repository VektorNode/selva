/**
 * How a user's name and email render together across admin and project UIs.
 *
 * Header-auth proxies commonly forward the same claim as both the display-name
 * and the email header (Entra sends `mail` for both when the display-name claim
 * is unmapped), so the two fields arrive identical and a naive
 * `name · email` renders "x@y.com · x@y.com". Every surface that shows the pair
 * has to collapse that case, so the test lives here rather than in each one.
 */

interface UserLike {
	displayName?: string | null;
	email?: string | null;
}

// Case-insensitive: the allowlist case-folds the UPN it materializes `email`
// from, but leaves the forwarded display name as the IdP sent it, so the
// duplicate pair often differs only in case.
export function displayNameIsEmail(user: UserLike): boolean {
	if (!user.displayName || !user.email) return false;
	return user.displayName.trim().toLowerCase() === user.email.trim().toLowerCase();
}

/** The email, only when it adds something the primary label didn't already say. */
export function emailSubtitle(user: UserLike): string | undefined {
	if (!user.displayName || !user.email) return undefined;
	return displayNameIsEmail(user) ? undefined : user.email;
}

/** Primary label: display name when there is a meaningful one, else email, else id. */
export function primaryLabel(user: UserLike, id: string): string {
	if (user.displayName && !displayNameIsEmail(user)) return user.displayName;
	return user.email ?? user.displayName ?? id;
}
