import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireInstanceAdmin } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { apiRoute, noContent, parseBody, requireParams } from '$lib/server/api/http';
import { slugify } from '@selvajs/platform';
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

export const GET: RequestHandler = apiRoute(
	'Failed to load platform project',
	async ({ params, locals }) => {
		requireInstanceAdmin(locals);
		const { id } = requireParams(params, 'id');
		return json(await loadPlatformProjectOr404(id));
	}
);

export const PATCH: RequestHandler = apiRoute(
	'Failed to update platform project',
	async ({ params, request, locals }) => {
		requireInstanceAdmin(locals);
		const { id } = requireParams(params, 'id');

		const input = await parseBody(request, UpdatePlatformProjectBody);
		await loadPlatformProjectOr404(id);

		const patch: { name?: string; slug?: string; description?: string } = {};
		if (input.name !== undefined) {
			patch.name = input.name;
			patch.slug = slugify(input.name);
		}
		if (input.description !== undefined) {
			patch.description = input.description ?? undefined;
		}

		await getProjectProvider().updateProject(SYSTEM_CONTEXT, id, patch);
		return noContent();
	}
);

export const DELETE: RequestHandler = apiRoute(
	'Failed to delete platform project',
	async ({ params, locals }) => {
		requireInstanceAdmin(locals);
		const { id } = requireParams(params, 'id');

		await loadPlatformProjectOr404(id);
		await getProjectProvider().deleteProject(SYSTEM_CONTEXT, id);
		return noContent();
	}
);
