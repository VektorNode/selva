import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageUsers } from '$lib/server/access.server';
import { throwZodError } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	DEFAULT_ORG_PERMISSIONS
} from '@selva/platform';
import { splitFlatPermissions } from '$lib/server/permissions-compat.server';

const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const UpdatePermissionsBody = z.object({
	permissions: z.array(FlatPermissionSchema)
});

// PATCH — update permissions. Splits the flat list into platform + default-org
// permissions and writes both. §1g-ui will replace with scoped endpoints.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireManageUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const body = await request.json().catch(() => null);
	const parsed = UpdatePermissionsBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { platform, org } = splitFlatPermissions(parsed.data.permissions);

	const platformResult = await getAuthProvider().updateUserPlatformPermissions(id, platform);
	if (platformResult === 'not_found') throw error(404, 'User not found');
	if (platformResult === 'not_supported')
		throw error(501, 'Platform permission updates not supported by this auth provider');

	const orgId = locals.ctx?.orgId;
	if (orgId) {
		const orgs = getOrganizationProvider();
		const existing = await orgs.getOrgMember(SYSTEM_CONTEXT, orgId, id);
		if (existing) {
			// In-place permission update. We cheat through the loader by re-adding
			// after removing — a clean updateOrgMemberPermissions will arrive in §1g-ui.
			await orgs.removeOrgMember(SYSTEM_CONTEXT, orgId, id);
			await orgs.addOrgMember(SYSTEM_CONTEXT, {
				...existing,
				permissions: org
			});
		} else {
			// Promote to member with the requested org perms.
			await orgs.addOrgMember(SYSTEM_CONTEXT, {
				orgId,
				userId: id,
				role: 'member',
				permissions: org.length > 0 ? org : [...DEFAULT_ORG_PERMISSIONS.member],
				joinedAt: new Date().toISOString()
			});
		}
	}

	return json({ success: true });
};

// DELETE — remove user
export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireManageUsers(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing user ID');

	const ok = await getAuthProvider().deleteUser(id);
	if (!ok) throw error(404, 'User not found or operation not supported');

	return json({ success: true });
};
