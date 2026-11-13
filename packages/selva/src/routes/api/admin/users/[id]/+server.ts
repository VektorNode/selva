import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getAuthProvider } from '#lib/server/providers.server.js';
import { getDataProvider, getEventSink, getPermissionStore } from '#lib/server/providers.server.js';
import {
	assertCanGrantPlatformPermissions,
	requireManageInstanceUsers
} from '#lib/server/access.server.js';
import {
	requireCanRemoveInstanceAdmin,
	requireEnabledToBecomeAdmin,
	withSoleOwnerGuard
} from '#lib/server/admin/instanceAdmins.server.js';
import { apiError, ApiErrorCode } from '#lib/server/api-errors.js';
import { apiRoute, noContent, parseBody, requireParams } from '#lib/server/api/http.js';
import {
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	type PlatformPermission,
	actorFrom
} from '@selvajs/platform';
import { setUserPlatformPermissions } from '#lib/server/permissions.server.js';
import { apiTokenResolutions } from '#lib/server/apiTokens/token.server.js';

const UpdatePermissionsBody = z.object({
	permissions: z.array(PlatformPermissionSchema)
});

// Platform scope only. Org role and permissions belong to
// PATCH /api/v1/orgs/{orgId}/members/{userId}, which gates on
// manage_org_members and enforces the sole-owner invariant — neither of which
// this handler's manage_instance_users check can stand in for.
export const PATCH: RequestHandler = apiRoute(
	'Failed to update platform permissions',
	async ({ params, request, locals }) => {
		requireManageInstanceUsers(locals);
		const { id } = requireParams(params, 'id');

		const { permissions: platform } = await parseBody(request, UpdatePermissionsBody);

		const existingPlatform: PlatformPermission[] = await getPermissionStore().getFor(
			locals.ctx!,
			id
		);
		assertCanGrantPlatformPermissions(locals.ctx!, platform, existingPlatform);
		await requireEnabledToBecomeAdmin(id, platform, existingPlatform);

		const platformResult = await setUserPlatformPermissions(locals.ctx!, id, platform);
		if (platformResult === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
		if (platformResult === 'not_supported')
			apiError(
				501,
				ApiErrorCode.INTERNAL,
				'Platform permission updates not supported by this auth provider'
			);
		if (platformResult === 'last_admin')
			apiError(
				409,
				ApiErrorCode.CONFLICT,
				'Cannot remove the last instance admin. Promote another user to instance admin first.'
			);

		return noContent();
	}
);

// DELETE — remove user. The §2 sole-`instance_admin` invariant and the
// platform-scope caller check are enforced here, BEFORE the auth provider
// deletes, by consulting the permission store (the auth provider no longer
// owns Selva-specific authorization).
export const DELETE: RequestHandler = apiRoute(
	'Failed to delete user',
	async ({ params, locals }) => {
		requireManageInstanceUsers(locals);
		const { id } = requireParams(params, 'id');

		const ctx = locals.ctx!;
		const { targetIsAdmin } = await requireCanRemoveInstanceAdmin(ctx, id, 'delete');

		const target = await withSoleOwnerGuard(id, async () => {
			// The email first: erasure scrubs invite and audit rows by it.
			const target = await getAuthProvider().getUser(id);
			if (!target) apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');

			// The check above reads, then this writes: `set` is the atomic step, so two
			// admins deleting each other cannot both get past it.
			const priorPermissions = await getPermissionStore().getFor(ctx, id);
			if (targetIsAdmin) {
				const revoked = await setUserPlatformPermissions(ctx, id, []);
				if (revoked === 'last_admin') {
					apiError(
						409,
						ApiErrorCode.CONFLICT,
						'Cannot delete the last instance admin. Promote another user to instance admin first.'
					);
				}
			}
			// A delete that did not happen must not cost the target their grant. The
			// erasure pass may already have dropped their data row, hence `ensureUser`.
			const restoreAdmin = async () => {
				if (!targetIsAdmin) return;
				await getDataProvider().ensureUser(SYSTEM_CONTEXT, id);
				await setUserPlatformPermissions(ctx, id, priorPermissions);
			};

			// Erasure before the identity, so a failed store write can be retried: with
			// the identity gone, a retry stops at 404 and the data stays.
			// Supabase erases what FK cascade does not reach (audit rows, invites by
			// email, solve telemetry); local removes its JSON rows and memberships.
			apiTokenResolutions.forgetUser(id);
			try {
				await getDataProvider().onUserDeleted(SYSTEM_CONTEXT, id, { email: target.email });
			} catch (err) {
				await restoreAdmin().catch(() => {});
				throw err;
			}

			const result = await getAuthProvider()
				.deleteUser(id)
				.catch(async (err: unknown) => {
					await restoreAdmin().catch(() => {});
					throw err;
				});
			if (result !== 'ok') await restoreAdmin().catch(() => {});
			if (result === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
			if (result === 'not_supported')
				apiError(501, ApiErrorCode.INTERNAL, 'User deletion not supported by this auth provider');
			return target;
		});

		// The target could still authenticate during the first pass: local's
		// `ensureUser` recreates their row, a token request re-caches its resolution,
		// and they can author audit and solve rows. This pass removes those. The
		// identity is gone, so a 500 here could not be retried; the log is the signal.
		apiTokenResolutions.forgetUser(id);
		try {
			await getDataProvider().onUserDeleted(SYSTEM_CONTEXT, id, { email: target.email });
		} catch (err) {
			locals.log.error('User deleted, but the second erasure pass failed', {
				userId: id,
				error: err instanceof Error ? err.message : String(err)
			});
		}

		// After both erasure passes, which delete audit rows this user authored.
		// The actor is the admin, so the row itself survives.
		await getEventSink().emit({ type: 'user.deleted', userId: id, actorId: actorFrom(ctx) });

		return noContent();
	}
);
