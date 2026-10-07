import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { projectScopeTarget } from '@selvajs/server/api';
import { reclaimProject } from '@selvajs/server/handlers';

const scopeTarget = projectScopeTarget('id');

export const POST: RequestHandler = mount('Failed to reclaim project', reclaimProject, {
	scopeTarget
});
