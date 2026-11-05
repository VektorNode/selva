import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { revokeShareLink } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

export const DELETE: RequestHandler = mount('Failed to revoke share link', revokeShareLink, {
	scopeTarget
});
