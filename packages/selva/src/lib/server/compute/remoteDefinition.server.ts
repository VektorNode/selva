/**
 * App-side binding for the remote-definition fetcher. The fetch itself — SSRF
 * guard, size cap, deadline, TTL cache — lives in `@selvajs/server`
 * (`createRemoteDefinitionFetcher`); this module owns the single app-wide
 * instance, wired with the env-derived limits and the real clock.
 */

import { createRemoteDefinitionFetcher } from '@selvajs/server/compute';
import {
	REMOTE_DEFINITION_MAX_BYTES,
	REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
	REMOTE_DEFINITION_CACHE_TTL_MS
} from '$lib/server/computeLimits';
// The fetcher is built once at module scope while the root logger is still
// being swapped in, so it takes the forwarding logger rather than a captured
// snapshot — see its definition for why.
import { lazyLogger } from '$lib/server/providers.server';

const fetcher = createRemoteDefinitionFetcher({
	maxBytes: REMOTE_DEFINITION_MAX_BYTES,
	fetchTimeoutMs: REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
	cacheTtlMs: REMOTE_DEFINITION_CACHE_TTL_MS,
	now: () => Date.now(),
	logger: lazyLogger
});

/** Fetch (or return cached) remote `.gh` bytes. Throws on unsafe host / oversized / timeout. */
export function loadRemoteDefinition(url: string): Promise<Uint8Array> {
	return fetcher.load(url);
}
