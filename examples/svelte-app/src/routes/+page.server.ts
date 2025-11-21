import { COMPUTE_URL, DEFAULT_API_KEY } from '$lib';
import { ComputeServerStats } from 'rhino-compute-core';
import type { PageServerLoad } from './$types';

export const load = (async () => {
  const serverStats = new ComputeServerStats(COMPUTE_URL, DEFAULT_API_KEY);
  const isOnline = await serverStats.isServerOnline();
  serverStats.dispose();

  return { isOnline };
}) satisfies PageServerLoad;
