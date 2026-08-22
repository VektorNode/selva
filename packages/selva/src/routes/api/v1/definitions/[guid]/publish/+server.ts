import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { publishDefinition } from '@selvajs/server/handlers';

export const POST: RequestHandler = mount('Failed to publish version', publishDefinition);
