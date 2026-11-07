import { assertNotShareContext, hasPermission, type RequestContext } from '../context.js';
import { ProviderError } from '../errors/index.js';

// For `IPlatformPermissionStore` adapters whose backing store is too coarse to enforce
// these themselves. Reading one row and reading many agree, and read access is not
// authority: `set` stays `instance_admin`-only.

/** May `ctx` read `userId`'s platform permissions? Throws `ProviderError(403)` if not. */
export function assertCanReadPermissions(ctx: RequestContext, userId: string): void {
	assertNotShareContext(ctx, 'read permissions');
	if (ctx.userId === userId || hasPermission(ctx, 'manage_instance_users')) return;
	throw new ProviderError('Forbidden: cannot read another user’s permissions', 403);
}

/** May `ctx` read several users' platform permissions? Throws `ProviderError(403)` if not. */
export function assertCanReadPermissionsBatch(ctx: RequestContext): void {
	assertNotShareContext(ctx, 'read permissions');
	if (hasPermission(ctx, 'manage_instance_users')) return;
	throw new ProviderError('Forbidden: instance admin or manage_instance_users required', 403);
}

/** May `ctx` change platform permissions? Throws `ProviderError(403)` if not. */
export function assertCanManagePermissions(ctx: RequestContext): void {
	assertNotShareContext(ctx, 'manage permissions');
	if (hasPermission(ctx, 'instance_admin')) return;
	throw new ProviderError('Forbidden: instance admin required', 403);
}
