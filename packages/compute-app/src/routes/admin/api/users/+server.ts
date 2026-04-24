import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuthProvider } from '$lib/server/auth.server';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageUsers } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import {
	OrgPermissionSchema,
	PlatformPermissionSchema,
	SYSTEM_CONTEXT,
	hasPermission,
	MEMBER_ASSIGNABLE_PERMISSIONS
} from '@selva/platform';
import { splitFlatPermissions, flattenPermissions } from '$lib/server/permissions-compat.server';

// §1g-core: the admin UI still sends a flat list of permissions. We accept it
// and split into platform + default-org scopes server-side. §1g-ui will replace
// this with two dedicated surfaces (Platform Admins + per-org Members).
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const BaseUserBody = z.object({
	email: z.string().email('Valid email is required'),
	permissions: z.array(FlatPermissionSchema)
});
const PasswordUserBody = BaseUserBody.extend({
	password: z.string().min(8, 'Password must be at least 8 characters').optional()
});

// GET — list all users with a flat "permissions" projection for the admin UI.
export const GET: RequestHandler = async ({ locals }) => {
	requireManageUsers(locals);
	const page = await getAuthProvider().listUsers({ limit: 200 });
	if (page === null) {
		throw error(
			501,
			'User management is not supported in single-password mode. Configure a users.json path to enable it.'
		);
	}

	// Merge each user's platform perms with their default-org perms so the
	// current admin UI sees the familiar flat list. Default org = ctx.orgId.
	const orgId = locals.ctx?.orgId;
	const orgs = getOrganizationProvider();
	const flattened = await Promise.all(
		page.items.map(async (u) => {
			let orgPerms: readonly string[] = [];
			if (orgId) {
				const member = await orgs.getOrgMember(SYSTEM_CONTEXT, orgId, u.id);
				orgPerms = member?.permissions ?? [];
			}
			return {
				...u,
				permissions: flattenPermissions(
					u.platformPermissions,
					orgPerms as Parameters<typeof flattenPermissions>[1]
				)
			};
		})
	);
	return json(flattened);
};

// POST — create a user + attach to default org with split permissions.
export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageUsers(locals);
	const auth = getAuthProvider();

	const body = await request.json().catch(() => null);
	const parsed = PasswordUserBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);
	const { email, password, permissions } = parsed.data;
	const { platform, org } = splitFlatPermissions(permissions);

	// Only an existing platform admin may create a user with platform-scope perms.
	if (platform.length > 0 && !hasPermission(locals.ctx!, 'platform_admin')) {
		throw error(403, 'Only a platform admin can grant platform-scope permissions');
	}

	try {
		let user;
		if (auth.passwordAuth) {
			if (!password) throw error(400, 'Password is required');
			user = await auth.passwordAuth.createUserWithPassword(email, password, platform);
		} else if (auth.createUser) {
			user = await auth.createUser(email, platform);
		} else {
			throw error(501, `User creation is not supported by ${auth.name}. Users are managed externally.`);
		}

		// Attach to the active org as a member. Members can only hold the
		// non-governance permissions (manage_definitions, manage_projects) —
		// drop anything else silently so the UI can send whatever.
		const orgId = locals.ctx?.orgId;
		if (orgId) {
			await getOrganizationProvider().addOrgMember(SYSTEM_CONTEXT, {
				orgId,
				userId: user.id,
				role: 'member',
				permissions: org.filter((p) => MEMBER_ASSIGNABLE_PERMISSIONS.includes(p)),
				joinedAt: new Date().toISOString()
			});
		}

		return json(user, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create user');
	}
};
