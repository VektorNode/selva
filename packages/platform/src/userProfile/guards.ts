import { assertNotShareContext, hasPermission, type RequestContext } from '../context.js';
import { ProviderError } from '../errors/index.js';

/**
 * For provider authors: may `ctx` read or change `userId`'s profile? Throws
 * `ProviderError(403)` if not.
 */
export function assertCanAccessProfile(ctx: RequestContext, userId: string): void {
	assertNotShareContext(ctx, 'access user profiles');
	if (ctx.userId === userId || hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: cannot access another user’s profile', 403);
}
