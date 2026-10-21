import type { RequestEvent } from '@sveltejs/kit';
import { mayHoldApiTokens } from '@selvajs/server/handlers';
import { ACCESS_PRESETS, type AccessPreset } from '$lib/apiTokens';
import { toApiRequest } from '../api/sveltekit';

/**
 * The token-form presets the signed-in user may mint in their acting org:
 * every preset for someone who may hold any key, the upload preset alone for
 * someone who may only hold upload keys, else none. Empty means the token page
 * and its tab stay hidden.
 */
export async function offeredTokenPresets(event: RequestEvent): Promise<AccessPreset[]> {
	const ctx = event.locals.ctx;
	if (!ctx) return [];
	const { deps } = toApiRequest(event);
	if (await mayHoldApiTokens(deps, ctx, ACCESS_PRESETS.full.scopes)) {
		return Object.keys(ACCESS_PRESETS) as AccessPreset[];
	}
	return (await mayHoldApiTokens(deps, ctx, ACCESS_PRESETS.upload.scopes)) ? ['upload'] : [];
}
