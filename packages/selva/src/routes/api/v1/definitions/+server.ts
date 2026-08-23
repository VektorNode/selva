import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { createDefinition, listDefinitions } from '@selvajs/server/handlers';

export const GET: RequestHandler = mount('Failed to list definitions', listDefinitions);
export const POST: RequestHandler = mount('Failed to create definition', createDefinition);
