import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getProjectProvider } from '$lib/server/providers.server';
import { requireCanManageMembers, requireTargetIsOrgMember } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { ProjectRoleSchema, type ProjectMember } from '@selvajs/platform';

const AddMemberSchema = z.object({
	userId: z.string().min(1, 'userId is required'),
	role: ProjectRoleSchema
});

export const GET: RequestHandler = async ({ params, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');
	await requireCanManageMembers(locals, id);
	const ctx = locals.ctx!;

	try {
		const page = await getProjectProvider().listProjectMembers(ctx, id, { limit: 200 });
		return json({ members: page.items });
	} catch (err) {
		handleApiError(err, 'Failed to load members');
	}
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { id } = params;
	if (!id) throw error(400, 'Missing project ID');
	await requireCanManageMembers(locals, id);
	const ctx = locals.ctx!;

	const body = await request.json().catch(() => null);
	const parsed = AddMemberSchema.safeParse(body);
	if (!parsed.success) throwZodError(parsed.error);

	const project = await getProjectProvider().getProject(ctx, id);
	if (!project) throw error(404, 'Project not found');
	await requireTargetIsOrgMember(locals, project.orgId, parsed.data.userId);

	const now = new Date().toISOString();
	const member: ProjectMember = {
		projectId: id,
		userId: parsed.data.userId,
		role: parsed.data.role,
		joinedAt: now,
		updatedAt: now,
		updatedBy: ctx.userId || parsed.data.userId,
		deletedAt: null
	};

	try {
		await getProjectProvider().addProjectMember(ctx, member);
		return json(member, { status: 201 });
	} catch (err) {
		handleApiError(err, 'Failed to add member');
	}
};
