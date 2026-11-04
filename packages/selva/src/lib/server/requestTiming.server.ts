// Opened per request in hooks.server.ts: `Server-Timing` on every response, and a `[timing]`
// record for a slow, sampled or cold request, with each upstream's calls.
import { createRequestTiming } from '@selvajs/server/http';
import { supabaseUpstream } from '@selvajs/supabase-provider';
import { env } from '$env/dynamic/private';
import { getLogger } from '$lib/server/providers.server';

export const requestTiming = createRequestTiming({
	log: (message, fields) => getLogger().info(message, fields),
	upstream: supabaseUpstream,
	labels: env.SELVA_RELEASE ? { release: env.SELVA_RELEASE } : {}
});
requestTiming.instrumentFetch();
