import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanCreateProject } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import { ProjectVisibilitySchema, ProviderError, type Project } from '@selva/platform';

const MAX_SLUG_ATTEMPTS = 25;

function isSlugConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_id_slug_key/.test(err.message)
	);
}

function isNameConflict(err: unknown): boolean {
	return (
		err instanceof ProviderError &&
		err.statusCode === 409 &&
		/projects_org_name_unique/.test(err.message)
	);
}

const CreateProjectBody = z.object({
	name: z.string().min(1, 'Project name is required').max(128).trim(),
	description: z.string().max(2000).optional(),
	visibility: ProjectVisibilitySchema.default('private'),
	autoJoinOnUpload: z.boolean().optional(),
	allowAnonymous: z.boolean().optional()
});

export const GET: RequestHandler = async ({ locals }) => {
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');
	try {
		const page = await getProjectProvider().listProjects(ctx, ctx.actingOrgId, { limit: 200 });
		return json({ projects: page.items });
	} catch (err) {
		handleApiError(err, 'Failed to load projects');
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const ctx = locals.ctx!;
	if (!ctx.actingOrgId) throw error(400, 'No active organization');
	await requireCanCreateProject(locals, ctx.actingOrgId);

	const body = await request.json().catch(() => null);
	const parsed = CreateProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const autoJoinOnUpload = parsed.data.autoJoinOnUpload ?? false;
	const allowAnonymous = parsed.data.allowAnonymous ?? false;
	if ((autoJoinOnUpload || allowAnonymous) && parsed.data.visibility !== 'public') {
		throw error(400, 'autoJoinOnUpload and allowAnonymous require visibility=public');
	}

	const projectStore = getProjectProvider();
	const baseSlug = slugify(parsed.data.name) || 'project';
	const now = new Date().toISOString();
	const projectId = randomUUID();

	// Retry on slug collision: the user may not be able to *see* a colliding
	// project under RLS, so a pre-flight getProjectBySlug isn't enough — the
	// unique-index is the source of truth. Retry up to MAX_SLUG_ATTEMPTS.
	for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
		const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
		const project: Project = {
			id: projectId,
			orgId: ctx.actingOrgId,
			name: parsed.data.name,
			slug,
			description: parsed.data.description,
			visibility: parsed.data.visibility,
			ownerId: locals.user!.id,
			createdBy: locals.user!.id,
			updatedBy: locals.user!.id,
			autoJoinOnUpload,
			allowAnonymous,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		try {
			await projectStore.createProject(ctx, project);
			return json(project, { status: 201 });
		} catch (err) {
			if (isNameConflict(err)) {
				throw error(409, 'A project with that name already exists in this organization.');
			}
			if (isSlugConflict(err)) continue;
			handleApiError(err, 'Failed to create project');
		}
	}

	throw error(409, 'Could not pick a unique project slug after several attempts.');
};
