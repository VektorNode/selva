import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { checkVersion } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

// `upload`: it extracts the schema through Compute exactly as an upload does.
export const POST: RequestHandler = mount('Failed to check definition version', checkVersion, {
	action: 'upload',
	scopeTarget
});
