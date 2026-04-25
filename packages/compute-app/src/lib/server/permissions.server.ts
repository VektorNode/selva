import type { PlatformPermission, UserManagementResult } from '@selva/platform';
import { getAuthProvider } from './auth.server.js';

/**
 * Permission read/write seam.
 *
 * Today `platformPermissions` live on the auth provider's `AuthUser`; the
 * future Eterna refactor moves them to a data-layer permission store so an
 * external IdP can own identity without owning Selva-specific authorization.
 *
 * Reads already funnel through `locals.user.platformPermissions` (set once
 * in `hooks.server.ts:buildContext`). Writes funnel through this module.
 * When the store moves, only this file and the hooks composition seam change.
 */

export async function setUserPlatformPermissions(
	userId: string,
	permissions: PlatformPermission[]
): Promise<UserManagementResult> {
	return getAuthProvider().updateUserPlatformPermissions(userId, permissions);
}
