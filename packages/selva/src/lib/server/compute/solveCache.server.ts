/**
 * App-wide single-flight for the solve path.
 *
 * This module used to also own the durable L2 solve cache. That backend is gone:
 * its only shipping implementation was an in-process `Map`, in the same heap and
 * behind the same restart boundary as the scheduler's own L1 — and L1 is consulted
 * first, so L2 could only ever serve what L1 had already evicted. The seam that
 * survives is `ISolveResultCache` in `@selvajs/platform`, which is where a real
 * shared backend (Redis) would mount if in-process caching ever stops being enough.
 *
 * What stays here is `solveCacheSingleFlight` — in-process dogpile protection the
 * route wraps every solve in, so N identical concurrent solves share one execution.
 * It is deliberately unconditional: the stampede it prevents is worst precisely
 * when nothing else is caching.
 */

import { createSolveCacheSingleFlight } from '@selvajs/solve/server';
import { getLogger } from '$lib/server/providers.server';
import { COMPUTE_DEBUG } from './clientCache.server';

/** In-process single-flight (R4), shared across the instance. */
export const solveCacheSingleFlight = createSolveCacheSingleFlight({
	onJoin: (key) => {
		if (COMPUTE_DEBUG) {
			// Key = version:server:tree-json — truncate the tree tail for the log.
			getLogger().debug('Coalesced onto in-flight solve', {
				component: 'Compute/single-flight',
				key: `${key.slice(0, 96)}…`
			});
		}
	}
});
