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
	DEFINITION_CACHE_TTL_MS
} from '$lib/server/computeLimits';

const fetcher = createRemoteDefinitionFetcher({
	maxBytes: REMOTE_DEFINITION_MAX_BYTES,
	fetchTimeoutMs: REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
	cacheTtlMs: DEFINITION_CACHE_TTL_MS,
	now: () => Date.now()
});

/** Fetch (or return cached) remote `.gh` bytes. Throws on unsafe host / oversized / timeout. */
export function loadRemoteDefinition(url: string): Promise<Uint8Array> {
	return fetcher.load(url);
}
