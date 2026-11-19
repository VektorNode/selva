import { getStorageProvider } from '#lib/server/providers.server.js';
import { createStash, STASH_SWEEP_EVERY_MS, type Stash } from './stash.js';

let stash: Stash | undefined;
let janitor: ReturnType<typeof setInterval> | undefined;

/** The stash on the configured storage provider, made on first use. */
export function mcpStash(): Stash {
	stash ??= createStash(getStorageProvider());
	return stash;
}

/**
 * Sweeps expired stash entries now and then hourly, so they go on time even when no MCP call
 * comes in. Once per process.
 */
export function startStashJanitor(): void {
	if (janitor) return;
	void mcpStash().sweep();
	janitor = setInterval(() => void mcpStash().sweep(), STASH_SWEEP_EVERY_MS);
	janitor.unref?.();
}
