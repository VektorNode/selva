import type { RequestHandler } from './$types';
import { mount } from '$lib/server/api/sveltekit';
import { uploadDefinitionImage } from '$lib/server/api/handlers/definitions';

export const POST: RequestHandler = mount('Failed to upload image', uploadDefinitionImage);
