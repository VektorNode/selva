import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireManageProjects, requireCanManage } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import { ProjectVisibilitySchema } from '@selva/platform';

const UpdateProjectBody = z
	.object({
		name: z.string().min(1).max(128).trim(),
		description: z.string().max(2000).nullish(),
		visibility: ProjectVisibilitySchema
	})
	.partial();

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');

	requireManageProjects(locals);
	const ctx = locals.ctx!;
	const allowed = await getProjectProvider().canEditProjectSettings(ctx, id);
	if (!allowed) throw error(403, 'You do not have permission to edit this project.');

	const body = await request.json().catch(() => null);
	const parsed = UpdateProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const patch: {
		name?: string;
		slug?: string;
		description?: string;
		visibility?: 'public' | 'org' | 'private';
	} = {};
	if (parsed.data.name !== undefined) {
		patch.name = parsed.data.name;
		patch.slug = slugify(parsed.data.name);
	}
	if (parsed.data.description !== undefined) {
		patch.description = parsed.data.description ?? undefined;
	}
	if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;

	try {
		await getProjectProvider().updateProject(ctx, id, patch);
		return json({ success: true });
	} catch (err) {
		handleApiError(err, 'Failed to update project');
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
		handleApiError(err, 'Failed to delete project');
	}
};
