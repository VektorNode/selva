import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getDataProvider, getEventSink, getPermissionStore } from '$lib/server/providers.server';
import {
	assertCanGrantPlatformPermissions,
	requireManageInstanceUsers
} from '$lib/server/access.server';
import { requireCanRemoveInstanceAdmin } from '$lib/server/admin/instanceAdmins.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, parseBody, requireParams } from '$lib/server/api/http';
import {
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	type PlatformPermission,
	actorFrom
} from '@selvajs/platform';
import { setUserPlatformPermissions } from '$lib/server/permissions.server';

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

		await requireCanRemoveInstanceAdmin(locals.ctx!, id, 'delete');

		// Capture the email BEFORE deletion — `onUserDeleted` needs it to scrub
		// invite/audit rows keyed by email, but the auth user is gone by then.
		const target = await getAuthProvider().getUser(id);
		const email = target?.email;

		const result = await getAuthProvider().deleteUser(id);
		if (result === 'not_found') apiError(404, ApiErrorCode.NOT_FOUND, 'User not found');
		if (result === 'not_supported')
			apiError(501, ApiErrorCode.INTERNAL, 'User deletion not supported by this auth provider');

		// Cascade + erasure: drop the user-data row and scrub personal data not
		// reachable by FK cascade (audit rows, invites-by-email, solve telemetry).
		// Supabase erases those explicitly; local removes its JSON rows + memberships.
		await getDataProvider().onUserDeleted(SYSTEM_CONTEXT, id, { email });

		// Emitted after the erasure pass, which deletes audit rows this user
		// authored — emitting first would delete the row recording their deletion.
		// The actor is the admin, so the row itself survives.
		await getEventSink().emit({
			type: 'user.deleted',
			userId: id,
			actorId: actorFrom(locals.ctx!)
		});

		return noContent();
	}
);
