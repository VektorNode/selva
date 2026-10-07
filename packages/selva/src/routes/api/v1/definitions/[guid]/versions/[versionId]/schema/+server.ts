import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { definitionScopeTarget } from '@selvajs/server/api';
import { getVersionSchema } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to load version schema', getVersionSchema, {
	scopeTarget
});
