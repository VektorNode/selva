import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { handleApiError, throwZodError, apiError, ApiErrorCode } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

const UpdatePlatformProjectBody = z
	.object({
		name: z.string().min(1).max(128).trim(),
		description: z.string().max(2000).nullish()
	})
	.partial();

async function loadPlatformProjectOr404(id: string) {
	const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, id);
	if (!project || project.visibility !== 'platform') {
		apiError(404, ApiErrorCode.NOT_FOUND, 'Platform project not found');
	}
	return project;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing project ID');
	try {
		const project = await loadPlatformProjectOr404(id);
		return json(project);
	} catch (err) {
		handleApiError(err, 'Failed to load platform project');
	}
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing project ID');

	const body = await request.json().catch(() => null);
	const parsed = UpdatePlatformProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	try {
		await loadPlatformProjectOr404(id);
		const patch: { name?: string; slug?: string; description?: string } = {};
		if (parsed.data.name !== undefined) {
			patch.name = parsed.data.name;
			patch.slug = slugify(parsed.data.name);
		}
		if (parsed.data.description !== undefined) {
			patch.description = parsed.data.description ?? undefined;
		}
		await getProjectProvider().updateProject(SYSTEM_CONTEXT, id, patch);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to update platform project');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireInstanceAdmin(locals);
	const { id } = params;
	if (!id) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing project ID');
	try {
		await loadPlatformProjectOr404(id);
		await getProjectProvider().deleteProject(SYSTEM_CONTEXT, id);
		return new Response(null, { status: 204 });
	} catch (err) {
		handleApiError(err, 'Failed to delete platform project');
	}
};
