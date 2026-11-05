import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { deleteVersion, getVersion } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to load version', getVersion, { scopeTarget });
export const DELETE: RequestHandler = mount('Failed to delete version', deleteVersion, {
	scopeTarget
});
