import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import {
	deleteDefinition,
	getDefinition,
	updateDefinition
} from '$lib/server/api/handlers/definitions';

export const GET: RequestHandler = mount('Failed to load definition', getDefinition);
export const DELETE: RequestHandler = mount('Failed to delete definition', deleteDefinition);
export const PATCH: RequestHandler = mount('Failed to update definition', updateDefinition);
