/**
 * App-wide instance of the remote-definition fetcher (SSRF guard, size cap,
 * deadline, TTL cache all live in `@selvajs/server`'s `createRemoteDefinitionFetcher`).
 */

import { createRemoteDefinitionFetcher } from '@selvajs/server/compute';
import {
	REMOTE_DEFINITION_MAX_BYTES,
	REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
	REMOTE_DEFINITION_CACHE_TTL_MS
} from '$lib/server/computeLimits';
// Module-scope init runs before the root logger is fully swapped in, so this
// needs the forwarding logger, not a snapshot that would pin the boot placeholder.
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
