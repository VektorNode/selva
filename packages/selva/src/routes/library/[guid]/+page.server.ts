import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import type { RequestContext } from '@selvajs/platform';
import { getDefinitionMeta } from '$lib/server/providers.server';
import { requireCanSolve } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { MAX_SOLVE_DURATION_MS } from '$lib/server/computeLimits';
import {
	loadDefinitionForRender,
	DefinitionLoadError
} from '$lib/server/definitions/loadForRender.server';

export const load = (async ({ params, locals, request, url }) => {
	const meta = getDefinitionMeta();

	const guid = params.guid;
	const channel = url.searchParams.get('channel') === 'draft' ? 'draft' : 'live';
	const clientDefUrl = `local:${guid}`;
	// `shareToken` is forwarded to the page so the client can include it on
	// subsequent /api/compute/solve calls. null = user-authenticated session.
	let shareToken: string | null = null;

	try {
		// Draft channel is editor-only — share tokens are always live channel.
		const sharedAccess =
			channel === 'live'
				? await tryResolveShareToken(request, url, guid, 'live', { requireSolve: false })
				: null;
		if (sharedAccess) {
			shareToken = url.searchParams.get('token');
		} else if (!locals.ctx || !locals.user) {
			throw error(401, 'Unauthorized: You must be logged in to access definitions');
		}

		const ctx: RequestContext = sharedAccess?.ctx ?? locals.ctx!;

		const record = await meta.get(ctx, guid);
		if (!record) throw new Error(`Definition '${guid}' not found`);

		// User-auth path needs the canSolve gate; token-auth was already gated.
		if (!sharedAccess) await requireCanSolve(locals, record.projectId);

		// Draft channel requires edit permission on top of solve.
		if (channel === 'draft') {
			const { requireEditableDefinition } = await import('$lib/server/access.server');
			await requireEditableDefinition(locals, guid);
		}

		const loaded = await loadDefinitionForRender(ctx, record, channel);

		return {
			schema: loaded.schema,
			ghDefinition: clientDefUrl,
			currentDefinition: guid,
			serverLabel: loaded.computeServer.label,
			channel,
			// Forward to the client so /api/compute/solve calls can include it.
			// Null when the request was user-authenticated (session cookie carries auth).
			shareToken,
			// Same deadline the server enforces on /api/compute, so the client's
			// AbortController matches the server's Promise.race.
			solveTimeoutMs: MAX_SOLVE_DURATION_MS
		};
	} catch (err) {
		// Let HttpError (from error() calls) bubble up.
		if (err instanceof Error && 'status' in err) throw err;

		// Translate classified load errors to the same HTTP statuses the route
		// used pre-extraction:
		//   missing-config | connect → 503 (operator action needed)
		//   schema                   → 500 (compute responded but IO/schema failed)
		//   data                     → 400 (definition references missing version/blob)
		if (err instanceof DefinitionLoadError) {
			if (err.kind === 'missing-config') {
				throw error(
					503,
					'No compute server configured. Ask an admin to add one in /admin/compute.'
				);
			}
			if (err.kind === 'connect') {
				console.error('[PageLoad] Compute server connection failed:', err.message);
				throw error(503, err.message);
			}
			if (err.kind === 'schema') {
				console.error('[PageLoad] Definition loading failed:', err.message);
				// eslint-disable-next-line no-restricted-properties -- NODE_ENV is OS-level, set by Node/Vite, not loaded from .env
				if (process.env.NODE_ENV === 'development') {
					const hint = `\n\nTroubleshooting:\n1. Check /api/health/compute to diagnose server connectivity\n2. Check the browser console for more details`;
					throw error(500, `Failed to load definition from ${clientDefUrl}: ${err.message}${hint}`);
				}
				throw error(500, `Failed to load definition: ${err.message}`);
			}
			// kind === 'data' falls through to the 400 wrap below.
		}

		if (err instanceof Error) {
			console.warn(`[App Load] Failed to load definition '${guid}':`, err);
			throw error(400, `Failed to load definition '${guid}': ${err.message}`);
		}
		throw err;
	}
}) satisfies PageServerLoad;
