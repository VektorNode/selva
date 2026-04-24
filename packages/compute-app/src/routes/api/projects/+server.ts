import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getOrganizationProvider, getProjectProvider } from '$lib/server/providers.server';
import { requireManageProjects } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { slugify } from '$lib/server/slug';
import { ProjectVisibilitySchema, type Project } from '@selva/platform';

const CreateProjectBody = z.object({
	name: z.string().min(1, 'Project name is required').max(128).trim(),
	description: z.string().max(2000).optional(),
	visibility: ProjectVisibilitySchema.default('public')
});

export const GET: RequestHandler = async ({ locals }) => {
	const ctx = locals.ctx!;
	try {
		const orgsPage = await getOrganizationProvider().listOrgs(ctx, { limit: 200 });
		const projectPages = await Promise.all(
			orgsPage.items.map((org) => getProjectProvider().listProjects(ctx, org.id, { limit: 200 }))
		);
		const projects = projectPages.flatMap((p) => p.items);
		return json({ projects });
	} catch (err) {
		handleApiError(err, 'Failed to load projects');
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageProjects(locals);
	const ctx = locals.ctx!;

	const body = await request.json().catch(() => null);
	const parsed = CreateProjectBody.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const orgsPage = await getOrganizationProvider().listOrgs(ctx, { limit: 1 });
	const org = orgsPage.items[0];
	if (!org) throw error(500, 'No organization configured');

	const now = new Date().toISOString();
	const project: Project = {
		id: randomUUID(),
		orgId: org.id,
		name: parsed.data.name,
		slug: slugify(parsed.data.name),
		description: parsed.data.description,
		visibility: parsed.data.visibility,
		ownerId: locals.user!.id,
		createdAt: now,
		updatedAt: now
	};

	try {
		await getProjectProvider().createProject(ctx, project);
		await getProjectProvider().addProjectMember(ctx, {
			projectId: project.id,
			userId: locals.user!.id,
			role: 'owner',
			joinedAt: now
		});
		return json(project, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to create project');
	}
};
