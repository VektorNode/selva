import { error, fail, redirect } from '@sveltejs/kit';
import {
	apiScopesFor,
	isLoopbackRedirect,
	OAuthError,
	type OAuthScope
} from '@selvajs/server/oauth';
import { canHoldApiTokens } from '@selvajs/server/tokens';
import { providers } from '$lib/server/providers.server';
import { oauthServer } from '$lib/server/oauth/server';
import type { Actions, PageServerLoad } from './$types';

// The shortest lifetime Settings → API tokens offers. No refresh tokens: on
// expiry the client gets a 401 and signs in again.
const TOKEN_DAYS = 30;

function serverFor(origin: string) {
	return oauthServer(origin) ?? error(503, 'OAuth is not configured on this server.');
}

/**
 * The authorize query without SvelteKit's `/action` key. The forms post to the
 * same query, so a failed action re-renders this page rather than a bare URL.
 */
function authorizeQuery(url: URL): string {
	const params = new URLSearchParams(url.search);
	for (const key of [...params.keys()]) if (key.startsWith('/')) params.delete(key);
	return params.toString();
}

async function parse(url: URL) {
	try {
		const query = new URLSearchParams(authorizeQuery(url));
		return { request: await serverFor(url.origin).parseAuthorizeRequest(query) };
	} catch (err) {
		if (err instanceof OAuthError) return { problem: err.message };
		throw err;
	}
}

export const load: PageServerLoad = async ({ url, locals }) => {
	// A bad client or redirect URI is shown, never redirected: the target is what can't be trusted.
	const { request, problem } = await parse(url);
	if (!request) return { ok: false as const, problem };

	// The hook gates this page; this covers a session that ended between the two.
	if (!locals.user || !locals.ctx) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	if (!locals.ctx.actingOrgId || !canHoldApiTokens(locals.ctx)) {
		return { ok: false as const, problem: 'Your account can’t create API tokens in this org.' };
	}
	const org = await providers.data.orgs.getOrg(locals.ctx, locals.ctx.actingOrgId);

	return {
		ok: true as const,
		query: authorizeQuery(url),
		clientName: request.client.name,
		redirectHost: new URL(request.redirectUri).host,
		loopback: isLoopbackRedirect(request.redirectUri),
		scopes: request.scopes,
		orgName: org?.name ?? 'this org',
		days: TOKEN_DAYS
	};
};

export const actions: Actions = {
	approve: async ({ request: req, url, locals, fetch }) => {
		const form = await req.formData();
		const { request } = await parse(url);
		if (!request) return fail(400, { error: 'This sign-in request is no longer valid.' });
		const orgId = locals.ctx?.actingOrgId;
		if (!orgId) return fail(403, { error: 'Sign in first.' });

		// The user may narrow what the client asked for, never widen it. `read` is always granted.
		const scopes: OAuthScope[] = form.get('access') === 'solve' ? request.scopes : ['read'];

		// Through the same endpoint as Settings → API tokens, so holder policy, scope
		// checks, the audit event and the owner's email all apply.
		const res = await fetch(`/api/v1/orgs/${encodeURIComponent(orgId)}/tokens`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: `${request.client.name} (OAuth)`.slice(0, 100),
				scopes: apiScopesFor(scopes),
				expiresInDays: TOKEN_DAYS
			})
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { message?: string };
			return fail(res.status, { error: body.message ?? 'The token could not be created.' });
		}
		const { token, secret } = (await res.json()) as {
			token: { id: string; expiresAt: string };
			secret: string;
		};
		redirect(
			303,
			serverFor(url.origin).approve(request, {
				tokenId: token.id,
				secret,
				scopes,
				expiresAt: token.expiresAt
			})
		);
	},

	deny: async ({ url }) => {
		const { request } = await parse(url);
		if (!request) return fail(400, { error: 'This sign-in request is no longer valid.' });
		redirect(303, serverFor(url.origin).deny(request));
	}
};
