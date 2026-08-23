import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, created, parseBody } from '$lib/server/api/http';
import {
	CreateOrgSchema,
	MAX_PAGE_LIMIT,
	ProviderError,
	type Organization
} from '@selvajs/platform';

/**
 * Spec §8 — instance-admin-only org management. Multi-tenant deployments use
 * this to create / list orgs out of band of the per-org invite flow. Self-
 * hosted single-tenant instances rarely call these.
 */

export const GET: RequestHandler = apiRoute('Failed to list orgs', async ({ locals, url }) => {
	requireInstanceAdmin(locals);

	const rawLimit = Number(url.searchParams.get('limit') ?? 200);
	const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT) : 200;
	const cursor = url.searchParams.get('cursor') ?? undefined;

	const page = await getOrganizationProvider().listOrgs(locals.ctx!, { limit, cursor });
	return json({ orgs: page.items, nextCursor: page.nextCursor });
});

export const POST: RequestHandler = apiRoute(
	'Failed to create org',
	async ({ request, locals }) => {
		const user = requireInstanceAdmin(locals);

		const input = await parseBody(request, CreateOrgSchema);

		const now = new Date().toISOString();
		const org: Organization = {
			id: randomUUID(),
			name: input.name,
			slug: input.slug,
			ownerId: user.id,
			createdBy: user.id,
			updatedBy: user.id,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		try {
			await getOrganizationProvider().createOrg(locals.ctx!, org);
		} catch (err) {
			// Slug collision is the most likely failure mode — surface it cleanly.
			if (err instanceof ProviderError && err.statusCode === 409) {
				apiError(409, ApiErrorCode.CONFLICT, err.message);
			}
			throw err;
		}

		return created(org);
	}
);
