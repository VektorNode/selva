import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import type { ILogger, RequestContext } from '@selvajs/platform';
import { renderThrown } from '@selvajs/server/logging';
import {
	getDefinitionMeta,
	getProjectProvider,
	getOrganizationProvider
} from '$lib/server/providers.server';
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
	// Explicit version pick (versioning tab "Run"): render an arbitrary version,
	// not just the live/draft pointer. Editor-only, never share-token accessible.
	const explicitVersionId = url.searchParams.get('version');
	const clientDefUrl = `local:${guid}`;
	// `shareToken` is forwarded to the page so the client can include it on
	// subsequent /api/compute/solve calls. null = user-authenticated session.
	let shareToken: string | null = null;

	try {
		// Draft channel and explicit-version picks are editor-only — share tokens
		// are always live channel on the pointer.
		const sharedAccess =
			channel === 'live' && !explicitVersionId
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

		// Draft channel and explicit-version picks require edit permission on top
		// of solve.
		if (channel === 'draft' || explicitVersionId) {
			const { requireEditableDefinition } = await import('$lib/server/access.server');
			await requireEditableDefinition(locals, guid);
		}

		const loaded = await loadDefinitionForRender(ctx, record, channel, explicitVersionId);

		// Owning org's logo, for viewer branding. Same `ctx` already authorized to
		// load this definition (user session or share-token ctx, which carries
		// actingOrgId). Best-effort: a missing project/org or read failure just
		// yields no logo — branding is non-essential and must never break a solve.
		const orgLogoUrl = await resolveOrgLogo(ctx, record.projectId, locals.log);

		return {
			schema: loaded.schema,
			ghDefinition: clientDefUrl,
			currentDefinition: guid,
			serverLabel: loaded.computeServer.label,
			orgLogoUrl,
			channel,
			// When rendering an explicit version, forward its id (so solve calls
			// target the same version) and number (for the preview badge).
			versionId: explicitVersionId,
			versionNumber: loaded.version.versionNumber,
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
				locals.log.error('Compute server connection failed', {
					component: 'PageLoad',
					guid,
					err: renderThrown(err)
				});
				throw error(503, err.message);
			}
			if (err.kind === 'schema') {
				locals.log.error('Definition loading failed', {
					component: 'PageLoad',
					guid,
					err: renderThrown(err)
				});

				if (process.env.NODE_ENV === 'development') {
					const hint = `\n\nTroubleshooting:\n1. Check /api/health/compute to diagnose server connectivity\n2. Check the browser console for more details`;
					throw error(500, `Failed to load definition from ${clientDefUrl}: ${err.message}${hint}`);
				}
				throw error(500, `Failed to load definition: ${err.message}`);
			}
			// kind === 'data' falls through to the 400 wrap below.
		}

		if (err instanceof Error) {
			locals.log.warn('Failed to load definition', {
				component: 'App Load',
				guid,
				err: renderThrown(err)
			});
			throw error(400, `Failed to load definition '${guid}': ${err.message}`);
		}
		throw err;
	}
}) satisfies PageServerLoad;

/**
 * Resolve the owning org's logo URL for viewer branding. definition → project →
 * org. Best-effort and self-contained: any miss or read error returns null so a
 * branding lookup can never fail the render path.
 */
async function resolveOrgLogo(
	ctx: RequestContext,
	projectId: string,
	log: ILogger
): Promise<string | null> {
	try {
		const project = await getProjectProvider().getProject(ctx, projectId);
		if (!project?.orgId) return null;
		const org = await getOrganizationProvider().getOrg(ctx, project.orgId);
		return org?.assets?.logo ?? null;
	} catch (err) {
		log.warn('Failed to resolve org logo', {
			component: 'App Load',
			projectId,
			err: renderThrown(err)
		});
		return null;
	}
}
