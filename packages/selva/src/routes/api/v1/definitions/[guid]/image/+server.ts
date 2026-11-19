import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { getDefinitionImage, uploadDefinitionImage } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to read image', getDefinitionImage, {
	scopeTarget
});

export const POST: RequestHandler = mount('Failed to upload image', uploadDefinitionImage, {
	scopeTarget
});
