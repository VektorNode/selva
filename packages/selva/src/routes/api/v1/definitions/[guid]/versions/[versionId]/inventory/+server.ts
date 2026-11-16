import type { RequestHandler } from './$types';
import { mount } from '#lib/server/api/sveltekit.js';
import { definitionScopeTarget } from '@selvajs/server/api';
import { refreshVersionInventory } from '@selvajs/server/handlers';

const scopeTarget = definitionScopeTarget('guid');

// `upload`: it reads the stored file through Compute, as an upload does.
export const POST: RequestHandler = mount(
	'Failed to read version inventory',
	refreshVersionInventory,
	{
		action: 'upload',
		scopeTarget
	}
);
