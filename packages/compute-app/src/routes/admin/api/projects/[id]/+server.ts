import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireManageProjects, requireCanManage, throwProviderError } from '$lib/server/access.server';
import type { ProjectVisibility } from '@selva/platform';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');
	requireManageProjects(locals);
	const ctx = locals.ctx!;
	const allowed = await getProjectProvider().canEditProjectSettings(ctx, id);
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { name, description, visibility } = body as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	if (typeof name === 'string' && name.trim()) {
		patch.name = name.trim();
		patch.slug = name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}
	if (description !== undefined)
		patch.description = typeof description === 'string' ? description : undefined;
	if (typeof visibility === 'string' && ['public', 'org', 'private'].includes(visibility)) {
		patch.visibility = visibility;
	}

	try {
		await getProjectProvider().updateProject(
			ctx,
			id,
			patch as {
				name?: string;
				slug?: string;
				description?: string;
				visibility?: ProjectVisibility;
			}
		);
		return json({ success: true });
	} catch (err) {
		throwProviderError(err, 'Failed to update project');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');
	await requireCanManage(locals, id);
	const ctx = locals.ctx!;

	try {
		await getProjectProvider().deleteProject(ctx, id);
		return json({ success: true });
	} catch (err) {
		throwProviderError(err, 'Failed to delete project');
	}
};
