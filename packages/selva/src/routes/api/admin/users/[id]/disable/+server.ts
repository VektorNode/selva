import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '#lib/server/api-errors.js';
import { apiRoute, noContent, requireParams } from '#lib/server/api/http.js';
import { getAuthProvider, getPermissionStore, providers } from '#lib/server/providers.server.js';
import { revokeUserApiTokens } from '@selvajs/server/handlers';
import { apiTokenResolutions } from '#lib/server/apiTokens/token.server.js';
import { requireManageInstanceUsers } from '#lib/server/access.server.js';
import {
	requireCanRemoveInstanceAdmin,
	withSoleOwnerGuard
} from '#lib/server/admin/instanceAdmins.server.js';
import { setUserPlatformPermissions } from '#lib/server/permissions.server.js';
import { getEventSink } from '#lib/server/providers.server.js';
import { actorFrom } from '@selvajs/platform';

/**
 * POST /api/admin/users/[id]/disable
 *
 * docs/contributing/permissions.md §10 — disable preserves identity and attribution. The §2
 * sole-`instance_admin` invariant is enforced here BEFORE the auth provider
 * disables, by consulting
 * `IPlatformPermissionStore.countInstanceAdminsExcluding`. Auth providers no
 * longer own Selva-specific authorization.
 *
 * Cutoff is not instant on every provider, and this route cannot make it so:
 * `sessionRefresh.revokeSession` takes the target's session token, which an
 * admin disabling someone else does not hold. Local and header-auth re-read the
 * user each request, so they cut off on the next one. Supabase keeps accepting
 * an already-issued access token until `revalidateMs` (default 60s) — but its
 * `refreshSession` rejects disabled users, so nothing new can be minted and the
 * window is bounded by the access token's own lifetime, not the 30-day refresh
 * token.
 *
 * No matching enable endpoint today — the auth interface is one-way for v1.
 * Re-enable lands when the spec defines an explicit re-onboarding flow.
 */
export const POST: RequestHandler = apiRoute(
	'Failed to disable user',
	async ({ params, locals }) => {
		requireManageInstanceUsers(locals);
		const { id } = requireParams(params, 'id');

		const ctx = locals.ctx!;
		const { targetIsAdmin } = await requireCanRemoveInstanceAdmin(ctx, id, 'disable');

		// A disabled owner cannot sign in, and nothing re-enables a user: an org
		// whose only owner is disabled has nobody left who can name another.
		await withSoleOwnerGuard(id, async () => {
			// Revoke before disabling. The local permission store cannot see the
			// disabled flag (it lives in the auth provider's file), so a disabled admin
			// still counts as live there: disable two admins in a row and the instance
			// reaches zero enabled admins with both checks having passed.
			//
			// Re-enabling does not restore the grant; an admin re-assigns it.
			const priorPermissions = await getPermissionStore().getFor(ctx, id);
			if (targetIsAdmin) {
				const revoked = await setUserPlatformPermissions(ctx, id, []);
				if (revoked === 'last_admin') {
					apiError(
						409,
						ApiErrorCode.CONFLICT,
						'Cannot disable the last instance admin. Promote another user to instance admin first.'
					);
				}
			}
			// A disable that did not happen must not cost the target their grant.
			const restoreAdmin = async () => {
				if (targetIsAdmin) await setUserPlatformPermissions(ctx, id, priorPermissions);
			};

			const result = await getAuthProvider()
				.disableUser(id)
				.catch(async (err: unknown) => {
					await restoreAdmin().catch(() => {});
					throw err;
				});
			if (result !== 'ok') await restoreAdmin().catch(() => {});
			if (result === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
			if (result === 'not_supported')
				apiError(
					501,
					ApiErrorCode.INTERNAL,
					'Disabling users is not supported by this auth provider'
				);
		});

		await getEventSink().emit({ type: 'user.disabled', userId: id, actorId: actorFrom(ctx) });

		await revokeUserApiTokens(
			providers.data.apiTokens,
			ctx,
			id,
			{ reason: 'user_disabled', resolutionCache: apiTokenResolutions },
			locals.log
		);

		return noContent();
	}
);
