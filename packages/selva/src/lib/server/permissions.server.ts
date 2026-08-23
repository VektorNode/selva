import type { PlatformPermission, RequestContext, UserManagementResult } from '@selvajs/platform';
import { actorFrom } from '@selvajs/platform';
import { getEventSink, getPermissionStore } from './providers.server.js';

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
	const result = await getPermissionStore().set(ctx, userId, permissions);
	// Emit only on success — a `last_admin` refusal or a missing user changed
	// nothing. Neither permission store takes an event sink, so this seam is
	// where the audit row gets written; every grant path routes through here.
	if (result === 'ok') {
		await getEventSink().emit({
			type: 'platform_permissions.changed',
			userId,
			permissions,
			actorId: actorFrom(ctx)
		});
	}
	return result;
}
