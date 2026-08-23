/**
 * This app's binding for the shared eviction diff.
 *
 * The diff moved to `@selvajs/server/compute`, which takes the eviction sink as
 * a parameter so it names no cache. Here the sink is the solve engine's warm
 * client cache, which is what makes this file app-specific.
 */

import { evictChangedServers as diff, type ServerConnection } from '@selvajs/server/compute';
import { evictComputeClient } from './engine.server';

export type { ServerConnection };

export function evictChangedServers(
	prev: readonly ServerConnection[],
	next: readonly ServerConnection[]
): void {
	diff(prev, next, evictComputeClient);
}
