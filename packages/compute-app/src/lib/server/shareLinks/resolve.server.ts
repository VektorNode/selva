import { error } from '@sveltejs/kit';
import type { DefinitionChannel, RequestContext, ShareLink } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { getDefinitionMeta, getProjectProvider, providers } from '../providers.server';
import { hashToken, looksLikeShareToken } from './token.server';

/**
 * Resolved share-link context attached to `locals` after successful token
 * resolution. The solve route reads `link` to know which counter to bump.
 */
export interface ResolvedShareLink {
	link: ShareLink;
	/** Synthetic ctx scoped to this token. Use in place of `locals.ctx`. */
	ctx: RequestContext;
}

/**
 * Extract a candidate share-link token from the request.
 *   - `?token=share_…` query param (most embeddable)
 *   - `Authorization: Bearer share_…` header (server-to-server)
 *
 * Returns the raw token string, or null when none present. Does NOT validate.
 */
export function readShareToken(request: Request, url: URL): string | null {
	const q = url.searchParams.get('token');
	if (q && looksLikeShareToken(q)) return q;

	const auth = request.headers.get('authorization');
	if (auth?.startsWith('Bearer ')) {
		const candidate = auth.slice('Bearer '.length).trim();
		if (looksLikeShareToken(candidate)) return candidate;
	}
	return null;
}

/**
 * Spec §7 token-resolution path. Run before user-based auth on definition-
 * scoped routes. Returns the resolved link + a synthetic ctx on success.
 *
 * Throws only when a token is *present but invalid* for the current request
 * (wrong definition, wrong channel, expired, revoked, view-only when solve
 * was requested) — those are deliberate 401/403/429 responses to a
 * misbehaving consumer. When no token is present at all, returns null and
 * the caller falls through to the user-based auth gate.
 */
export async function tryResolveShareToken(
	request: Request,
	url: URL,
	requestedDefinitionId: string,
	requestedChannel: DefinitionChannel,
	opts: { requireSolve: boolean }
): Promise<ResolvedShareLink | null> {
	const raw = readShareToken(request, url);
	if (!raw) return null;

	const tokenHash = hashToken(raw);
	// System ctx for every read on this path — the token IS the credential, and
	// the synthetic ctx we hand back has no `auth.uid()`. Without `system: true`
	// the Supabase adapter would fall back to the anon client and RLS would
	// scope every downstream read to nothing.
	const link = await providers.data.shareLinks.getByTokenHash(SYSTEM_CONTEXT, tokenHash);

	if (!link) throw error(401, 'Invalid or revoked share token.');

	if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
		throw error(401, 'Share token has expired.');
	}

	if (link.definitionId !== requestedDefinitionId) {
		throw error(403, 'Share token is not valid for this definition.');
	}
	if (link.channel !== requestedChannel) {
		throw error(403, `Share token is for the '${link.channel}' channel only.`);
	}
	if (opts.requireSolve && !link.allowSolve) {
		throw error(403, 'Share token grants view-only access.');
	}

	// Verify the parent definition is still live; without this, a deleted
	// definition with a leaked token would still return data via blob lookup.
	const def = await getDefinitionMeta().get(SYSTEM_CONTEXT, link.definitionId);
	if (!def) throw error(401, 'Share token target no longer exists.');

	const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, def.projectId);
	if (!project) throw error(401, 'Share token target no longer exists.');

	// Synthetic ctx for the downstream solve. `system: true` so adapter dispatch
	// uses the service-role client — no user JWT exists on a token-credentialed
	// request, and we've already validated the token gates this exact
	// (definition, channel) pair. Tenancy info (`actingOrgId`) is included so
	// org-scoped lookups (e.g. compute server resolution) still target the
	// right tenant.
	const ctx: RequestContext = {
		userId: '',
		actingOrgId: project.orgId,
		platformPermissions: [],
		orgPermissions: [],
		system: true
	};

	return { link, ctx };
}
