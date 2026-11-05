import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { getDefinitionSchema } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to load definition schema', getDefinitionSchema, {
	scopeTarget
});
