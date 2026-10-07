import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { definitionScopeTarget } from '@selvajs/server/api';
import { uploadDefinitionImage } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const POST: RequestHandler = mount('Failed to upload image', uploadDefinitionImage, {
	scopeTarget
});
