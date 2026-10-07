import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { definitionScopeTarget } from '@selvajs/server/api';
import { createShareLink, listShareLinks } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const GET: RequestHandler = mount('Failed to list share links', listShareLinks, {
	scopeTarget
});
export const POST: RequestHandler = mount('Failed to create share link', createShareLink, {
	scopeTarget
});
