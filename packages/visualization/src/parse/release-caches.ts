import { releaseAllCaches } from '../shared/index.js';

/**
 * Free every cross-solve GPU cache — cached geometries, textures and edge segments.
 *
 * **You do not normally need this.** These caches register themselves for teardown, so the viewer's
 * `dispose()` already frees them once the last live viewer goes away. It is exported for the cases
 * that sit outside a viewer lifecycle: reclaiming memory under pressure, or a test isolating
 * module-level state.
 *
 * Safe to call repeatedly and with a viewer running — the caches simply repopulate on the next solve.
 */
export function releaseParseCaches(): void {
	releaseAllCaches();
}
