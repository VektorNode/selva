import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import {
	CreateOrgSchema,
	ProviderError,
	type Organization
} from '@selva/platform';

/**
 * Spec §7 — instance-admin-only org management. Multi-tenant deployments use
 * this to create / list orgs out of band of the per-org invite flow. Self-
 * hosted single-tenant instances rarely call these.
 */

export const GET: RequestHandler = async ({ locals, url }) => {
	requireInstanceAdmin(locals);
	const ctx = locals.ctx!;

	const limit = Number(url.searchParams.get('limit') ?? 200);
	const cursor = url.searchParams.get('cursor') ?? undefined;

	try {
		const page = await getOrganizationProvider().listOrgs(ctx, { limit, cursor });
		return json({ orgs: page.items, nextCursor: page.nextCursor });
	} catch (err) {
		handleApiError(err, 'Failed to list orgs');
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireInstanceAdmin(locals);
	const ctx = locals.ctx!;

	const body = await request.json().catch(() => null);
	const parsed = CreateOrgSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const now = new Date().toISOString();
	const org: Organization = {
		id: randomUUID(),
		name: parsed.data.name,
		slug: parsed.data.slug,
		ownerId: user.id,
		createdBy: user.id,
		updatedBy: user.id,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};

	try {
		await getOrganizationProvider().createOrg(ctx, org);
		return json(org, { status: 201 });
	} catch (err) {
		// Slug collision is the most likely failure mode — surface it cleanly.
		if (err instanceof ProviderError && err.statusCode === 409) {
			throw error(409, err.message);
		}
		handleApiError(err, 'Failed to create org');
	}
};
