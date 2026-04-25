import type { PlatformPermission, RequestContext, UserManagementResult } from '@selva/platform';
import { getPermissionStore } from './providers.server.js';

/**
 * Permission read/write seam over `IPlatformPermissionStore`. Reads happen
 * via `locals.ctx.platformPermissions` (set once in `hooks.server.ts`);
 * writes funnel through this module so any future change (caching,
 * invalidation, audit hooks) is one-file.
 */

export async function setUserPlatformPermissions(
	ctx: RequestContext,
	userId: string,
	permissions: PlatformPermission[]
): Promise<UserManagementResult> {
	return getPermissionStore().set(ctx, userId, permissions);
}
