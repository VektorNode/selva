import { error } from '@sveltejs/kit';
import type { DefinitionChannel, RequestContext, ShareLink } from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { flag, getDefinitionMeta, getProjectProvider, providers } from '../providers.server';
import { hashToken, looksLikeShareToken } from './token.server';

/**
 * Resolved share-link context attached to `locals` after successful token
 * resolution. The solve route reads `link` to know which counter to bump.
 */
export interface ResolvedShareLink {
	link: ShareLink;
	/** Use in place of `locals.ctx`. */
	ctx: RequestContext;
}

/**
 * Extracts a candidate share-link token from the request — `?token=share_…`
 * query param, or `Authorization: Bearer share_…` header. Returns the raw
 * token, or null when none present. Does NOT validate.
 */
export function readShareToken(request: Request, url: URL): string | null {
	// Disabling sharing instance-wide makes every token on the wire stop
	// granting access, without revoking each one — callers fall through to
	// user-based auth, which 401s anonymous requests.
	if (!flag('ENABLE_SHARING')) return null;

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
 * Runs before user-based auth on definition-scoped routes.
 *
 * Throws only when a token is *present but invalid* (wrong definition, wrong
 * channel, expired, revoked, view-only when solve was requested) — deliberate
 * 401/403/429 responses to a misbehaving consumer. When no token is present
 * at all, returns null and the caller falls through to user-based auth.
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
	// System ctx: the token IS the credential, and the synthetic ctx returned
	// below has no `auth.uid()`. Without `system: true` the Supabase adapter
	// falls back to the anon client and RLS scopes every read to nothing.
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

	// Without this check, a deleted definition with a leaked token would still
	// return data via blob lookup.
	const def = await getDefinitionMeta().get(SYSTEM_CONTEXT, link.definitionId);
	if (!def) throw error(401, 'Share token target no longer exists.');

	const project = await getProjectProvider().getProject(SYSTEM_CONTEXT, def.projectId);
	if (!project) throw error(401, 'Share token target no longer exists.');

	// `system: true` for the same reason as above — no user JWT exists on a
	// token-credentialed request. `actingOrgId` lets org-scoped lookups (e.g.
	// compute server resolution) still target the right tenant.
	//
	// `shareLinkId` narrows what `system` is allowed to mean here: a bare
	// `if (ctx.system) return` guard would otherwise treat an anonymous token
	// holder as an instance admin. The sentinel `userId` keeps the same
	// distinction in audit rows, which render a blank actor as "System".
	const ctx: RequestContext = {
		userId: `share:${link.id}`,
		actingOrgId: project.orgId,
		platformPermissions: [],
		orgPermissions: [],
		system: true,
		shareLinkId: link.id
	};

	return { link, ctx };
}
