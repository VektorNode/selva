import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { starDefinition, unstarDefinition } from '@selvajs/server/handlers';

export const PUT: RequestHandler = mount('Failed to star definition', starDefinition);
export const DELETE: RequestHandler = mount('Failed to unstar definition', unstarDefinition);
