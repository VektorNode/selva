import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { definitionScopeTarget } from '@selvajs/server/api';
import { deleteDefinition, getDefinition, updateDefinition } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to load definition', getDefinition, {
	scopeTarget
});
export const DELETE: RequestHandler = mount('Failed to delete definition', deleteDefinition, {
	scopeTarget
});
export const PATCH: RequestHandler = mount('Failed to update definition', updateDefinition, {
	scopeTarget
});
