import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { getVersionScriptDiff } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

// `upload`: script code shows how the definition works, so it is for those who may change it.
export const GET: RequestHandler = mount('Failed to read script changes', getVersionScriptDiff, {
	action: 'upload',
	scopeTarget
});
