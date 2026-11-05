import { redirect, type RequestEvent } from '@sveltejs/kit';
import { env } from '#lib/server/env.js';
import { resolveSignInMaxAgeMs, signInIsStale } from '@selvajs/server/http';
import { getAuthProvider } from '#lib/server/providers.server.js';
import { destroySession, getSessionToken } from '#lib/server/admin-auth.server.js';

// Throws on a malformed value, so a typo stops the boot instead of switching
// the check off.
export const signInMaxAgeMs = resolveSignInMaxAgeMs(env);

/**
 * Sends a user whose last real sign-in is older than the max age to sign in
 * again (`/login?reauth=1` ends their session), back to `event.url` afterwards. For pages that
 * hand out a credential: a key minted on a stale sign-in would be refused at
 * once. Under proxy auth every visit is a sign-in, so it never fires there.
 */
export async function requireRecentSignIn(event: RequestEvent): Promise<void> {
	const user = event.locals.user;
	if (!user || !signInMaxAgeMs) return;
	const auth = getAuthProvider();
	const signedIn = await auth.getUser(user.id);
	if (!signInIsStale(signedIn?.lastLoginAt, signInMaxAgeMs, Date.now())) return;

	const back = event.url.pathname + event.url.search;
	redirect(303, `/login?reauth=1&redirectTo=${encodeURIComponent(back)}`);
}

/**
 * Ends the current session so `/login` shows its form instead of bouncing a
 * signed-in user away. Proxy-owned sessions can't be ended here; under proxy
 * auth every visit is a fresh sign-in anyway.
 */
export async function endSessionForReauth(event: Pick<RequestEvent, 'cookies'>): Promise<boolean> {
	const auth = getAuthProvider();
	if (auth.proxyAuth) return false;
	const token = getSessionToken(event.cookies);
	if (token) await auth.sessionRefresh?.revokeSession(token);
	destroySession(event.cookies);
	return true;
}
