import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getInviteStore, getOrganizationProvider } from '$lib/server/providers.server';
import { requireManageUsers } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import {
	OrgRoleSchema,
	OrgPermissionSchema,
	PlatformPermissionSchema,
	type Invite
} from '@selva/platform';
import { splitFlatPermissions } from '$lib/server/permissions-compat.server';

// §1g-core: still accept the legacy flat `permissions[]` from the current admin UI.
// Platform-scope entries are silently dropped — invites only grant org rights.
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

const CreateBody = z.object({
	email: z
		.string()
		.email('Valid email is required')
		.transform((s) => s.toLowerCase().trim()),
	orgRole: OrgRoleSchema.default('member'),
	permissions: z.array(FlatPermissionSchema).default([])
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

// GET — list pending (and recently accepted) invites for the active org
export const GET: RequestHandler = async ({ locals }) => {
	requireManageUsers(locals);
	const ctx = locals.ctx!;
	try {
		const orgsPage = await getOrganizationProvider().listOrgs(ctx, { limit: 1 });
		const org = orgsPage.items[0];
		if (!org) throw error(500, 'No organization configured');
		const page = await getInviteStore().listByOrg(ctx, org.id, { limit: 200 });
		return json(page.items);
	} catch (err) {
		handleApiError(err, 'Failed to list invites');
	}
};

// POST — create an invite, return the shareable accept URL
export const POST: RequestHandler = async ({ request, locals, url }) => {
	requireManageUsers(locals);
	const ctx = locals.ctx!;
	const user = locals.user!;

	const body = await request.json().catch(() => null);
	const parsed = CreateBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		const orgsPage = await getOrganizationProvider().listOrgs(ctx, { limit: 1 });
		const org = orgsPage.items[0];
		if (!org) throw error(500, 'No organization configured');

		const { org: orgPermissions } = splitFlatPermissions(parsed.data.permissions);

		const now = new Date();
		const invite: Invite = {
			id: randomUUID(),
			token: generateToken(),
			email: parsed.data.email,
			orgId: org.id,
			orgRole: parsed.data.orgRole,
			orgPermissions,
			invitedBy: user.id,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString()
		};
		await getInviteStore().create(ctx, invite);

		const acceptUrl = `${url.origin}/accept-invite?token=${invite.token}`;
		return json({ invite, acceptUrl }, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create invite');
	}
};
