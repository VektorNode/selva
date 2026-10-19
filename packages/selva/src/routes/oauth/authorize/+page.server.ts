import { error, fail, redirect } from '@sveltejs/kit';
import { apiScopesFor, OAuthError, type OAuthScope } from '@selvajs/server/oauth';
import { canHoldApiTokens } from '@selvajs/server/tokens';
import { providers } from '$lib/server/providers.server';
import { oauthServer } from '$lib/server/oauth/server';
import type { Actions, PageServerLoad } from './$types';

// The shortest lifetime Settings → API tokens offers. No refresh tokens: on
// expiry the client gets a 401 and signs in again.
const TOKEN_DAYS = 30;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function serverFor(origin: string) {
	return oauthServer(origin) ?? error(503, 'OAuth is not configured on this server.');
}

/** The authorize query, from the page URL on load and from a hidden field on submit. */
async function parse(origin: string, query: string) {
	try {
		return { request: await serverFor(origin).parseAuthorizeRequest(new URLSearchParams(query)) };
	} catch (err) {
		if (err instanceof OAuthError) return { problem: err.message };
		throw err;
	}
}

export const load: PageServerLoad = async ({ url, locals }) => {
	// A bad client or redirect URI is shown, never redirected: the target is what can't be trusted.
	const { request, problem } = await parse(url.origin, url.search);
	if (!request) return { ok: false as const, problem };

	if (!locals.user || !locals.ctx) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	if (!locals.ctx.actingOrgId || !canHoldApiTokens(locals.ctx)) {
		return { ok: false as const, problem: 'Your account can’t create API tokens in this org.' };
	}
	const org = await providers.data.orgs.getOrg(locals.ctx, locals.ctx.actingOrgId);
	const redirectHosts = [...new Set(request.client.redirectUris.map((u) => new URL(u).hostname))];

	return {
		ok: true as const,
		query: url.search,
		clientName: request.client.name,
		redirectHost: new URL(request.redirectUri).host,
		loopbackOnly: redirectHosts.every((h) => LOOPBACK.has(h)),
		scopes: request.scopes,
		orgName: org?.name ?? 'this org',
		days: TOKEN_DAYS
	};
};

export const actions: Actions = {
	approve: async ({ request: req, url, locals, fetch }) => {
		const form = await req.formData();
		const { request } = await parse(url.origin, String(form.get('query') ?? ''));
		if (!request) return fail(400, { error: 'This sign-in request is no longer valid.' });
		const orgId = locals.ctx?.actingOrgId;
		if (!orgId) return fail(403, { error: 'Sign in first.' });

		// The user may narrow what the client asked for, never widen it.
		const access = form.get('access') === 'solve' ? 'solve' : 'read';
		const scopes: OAuthScope[] = request.scopes.filter((s) => s === 'read' || s === access);

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

	deny: async ({ request: req, url }) => {
		const form = await req.formData();
		const { request } = await parse(url.origin, String(form.get('query') ?? ''));
		if (!request) return fail(400, { error: 'This sign-in request is no longer valid.' });
		redirect(303, serverFor(url.origin).deny(request));
	}
};
