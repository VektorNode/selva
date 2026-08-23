import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, parseBody, requireParams } from '$lib/server/api/http';
import { UpdateOrgSchema, ProviderError } from '@selvajs/platform';

export const PATCH: RequestHandler = apiRoute(
	'Failed to update org',
	async ({ params, request, locals }) => {
		requireInstanceAdmin(locals);
		const { id } = requireParams(params, 'id');
		const ctx = locals.ctx!;

		const patch = await parseBody(request, UpdateOrgSchema);

		try {
			await getOrganizationProvider().updateOrg(ctx, id, patch);
		} catch (err) {
			// Slug collision reads as a conflict, not an internal failure.
			if (err instanceof ProviderError && err.statusCode === 409) {
				apiError(409, ApiErrorCode.CONFLICT, err.message);
			}
			throw err;
		}

		return json(await getOrganizationProvider().getOrg(ctx, id));
	}
);

export const DELETE: RequestHandler = apiRoute(
	'Failed to delete org',
	async ({ params, locals }) => {
		requireInstanceAdmin(locals);
		const { id } = requireParams(params, 'id');

		await getOrganizationProvider().deleteOrg(locals.ctx!, id);
		return noContent();
	}
);
