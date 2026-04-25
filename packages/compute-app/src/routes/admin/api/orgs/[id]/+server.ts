import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrganizationProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { UpdateOrgSchema, ProviderError } from '@selva/platform';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing org ID');
	const ctx = locals.ctx!;

	const body = await request.json().catch(() => null);
	const parsed = UpdateOrgSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		await getOrganizationProvider().updateOrg(ctx, id, parsed.data);
		const updated = await getOrganizationProvider().getOrg(ctx, id);
		return json(updated);
	} catch (err) {
		if (err instanceof ProviderError && err.statusCode === 409) {
			throw error(409, err.message);
		}
		handleApiError(err, 'Failed to update org');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) throw error(400, 'Missing org ID');
	const ctx = locals.ctx!;

	try {
		await getOrganizationProvider().deleteOrg(ctx, id);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to delete org');
	}
};
