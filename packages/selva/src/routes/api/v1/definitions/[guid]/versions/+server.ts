import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { definitionScopeTarget } from '@selvajs/server/api';
import { listVersions, uploadVersion } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to list versions', listVersions, { scopeTarget });
export const POST: RequestHandler = mount('Failed to upload definition version', uploadVersion, {
	scopeTarget
});
