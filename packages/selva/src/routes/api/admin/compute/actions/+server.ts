import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { findServerById } from '@selvajs/platform';
import { requireManageCompute } from '$lib/server/access.server';
import { ComputeServerStats } from '@selvajs/compute/grasshopper';
import {
	clearSolveResultCache,
	clearDefinitionCache,
	solveCacheStats,
	definitionByteCacheStats
} from '$lib/server/compute/engine.server';

/**
 * Admin compute actions — `manage_compute` only. Operator-initiated, mutating
 * cache/fleet controls that the read-only `/status` route deliberately omits.
 *
 * Targeting a single platform server by `serverId`:
 *
 *   action: 'purge'    → best-effort fleet-wide cache purge (purgeAllChildren)
 *   action: 'shutdown' → graceful shutdown of all child processes (shutdownChildren)
 *
 * Process-wide, no `serverId` — these clear Selva's own in-memory caches, the
 * layer in front of Rhino.Compute that `purge` never reaches:
 *
 *   action: 'clear-solve-cache'      → cached solve results on every warm client
 *   action: 'clear-definition-cache' → retained `.gh` bytes
 *
 * All are POST (not GET) so they can't be triggered by a stray prefetch — they
 * wake/drain real processes or throw away work already paid for.
 */

type Action = 'purge' | 'shutdown' | 'clear-solve-cache' | 'clear-definition-cache';

const ACTIONS: Action[] = ['purge', 'shutdown', 'clear-solve-cache', 'clear-definition-cache'];

interface ActionBody {
	serverId?: string;
	action?: Action;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	requireManageCompute(locals);

	const body = (await request.json().catch(() => null)) as ActionBody | null;
	if (!body || typeof body !== 'object')
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Invalid request body');

	const { serverId, action } = body;
	if (!action || !ACTIONS.includes(action))
		apiError(400, ApiErrorCode.VALIDATION_FAILED, `action must be one of: ${ACTIONS.join(', ')}`);

	// Selva's own in-memory caches — process-wide, so no server to target. Report
	// what was dropped by reading the counters before clearing.
	if (action === 'clear-solve-cache') {
		const { entries, bytes } = solveCacheStats();
		clearSolveResultCache();
		return json({ action, entries, bytes });
	}

	if (action === 'clear-definition-cache') {
		const { entries, bytes } = definitionByteCacheStats();
		clearDefinitionCache();
		return json({ action, entries, bytes });
	}

	if (!serverId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'serverId required');

	// Admin route — read the full config; admin can act on any server. Only the
	// targeted server's key is decrypted.
	const store = getComputeServerConfigStore();
	const config = await store.getConfig(locals.ctx!);
	const server = findServerById(config, serverId);
	if (!server) apiError(404, ApiErrorCode.NOT_FOUND, 'Server not found');

	const apiKey = server.hasApiKey ? await store.getServerApiKey(locals.ctx!, server.id) : undefined;
	const stats = new ComputeServerStats(server.serverUrl, apiKey);
	try {
		if (action === 'purge') {
			const result = await stats.purgeAllChildren();
			if (result === null)
				apiError(502, ApiErrorCode.INTERNAL, 'Could not reach the server to purge its cache');
			return json({ action, ...result });
		}

		// action === 'shutdown' — no port filter, so the server shuts down every child.
		const result = await stats.shutdownChildren();
		if (result === null)
			apiError(502, ApiErrorCode.INTERNAL, 'Could not reach the server to shut down its children');
		return json({ action, ...result });
	} finally {
		await stats.dispose();
	}
};
