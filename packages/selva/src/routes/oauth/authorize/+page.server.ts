import { error, fail, redirect } from '@sveltejs/kit';
import {
	apiScopesFor,
	consentChoices,
	isLoopbackRedirect,
	OAuthError
} from '@selvajs/server/oauth';
import { consentOrgs, mintConsentToken } from '@selvajs/server/handlers';
import { isApiError } from '@selvajs/server/api';
import { toApiRequest } from '$lib/server/api/sveltekit';
import { oauthServer } from '$lib/server/oauth/server';
import type { Actions, PageServerLoad } from './$types';

// The shortest lifetime the token page offers. No refresh tokens: on expiry
// the client gets a 401 and signs in again.
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

export const load: PageServerLoad = async (event) => {
	const { url, locals } = event;
	// A bad client or redirect URI is shown, never redirected: the target is what can't be trusted.
	const { request, problem } = await parse(url);
	if (!request) return { ok: false as const, problem };

	// The hook gates this page; this covers a session that ended between the two.
	if (!locals.user || !locals.ctx) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}

	const choices = consentChoices(request.scopes);
	const orgs = await consentOrgs(toApiRequest(event), apiScopesFor(choices[0]!.scopes));
	if (!orgs.length) {
		return {
			ok: false as const,
			problem: 'Your account can’t give an app this access in any of your organizations.'
		};
	}
	const acting = orgs.find((o) => o.id === locals.ctx?.actingOrgId);

	return {
		ok: true as const,
		query: authorizeQuery(url),
		clientName: request.client.name,
		builtIn: request.client.builtIn,
		redirectHost: new URL(request.redirectUri).host,
		loopback: isLoopbackRedirect(request.redirectUri),
		choices: choices.map((c) => c.access),
		orgs,
		orgId: (acting ?? orgs[0]!).id,
		days: TOKEN_DAYS
	};
};

export const actions: Actions = {
	approve: async (event) => {
		const form = await event.request.formData();
		const { request } = await parse(event.url);
		if (!request) return fail(400, { error: 'This sign-in request is no longer valid.' });
		if (!event.locals.ctx) return fail(403, { error: 'Sign in first.' });

		const choices = consentChoices(request.scopes);
		const choice = choices.find((c) => c.access === form.get('access')) ?? choices[0]!;
		let minted;
		try {
			minted = await mintConsentToken(toApiRequest(event), String(form.get('orgId') ?? ''), {
				name: `${request.client.name} (OAuth)`.slice(0, 100),
				scopes: apiScopesFor(choice.scopes),
				expiresInDays: TOKEN_DAYS
			});
		} catch (err) {
			if (isApiError(err)) return fail(err.status, { error: err.message });
			throw err;
		}
		redirect(
			303,
			serverFor(event.url.origin).approve(request, {
				tokenId: minted.token.id,
				secret: minted.secret,
				scopes: choice.scopes,
				expiresAt: minted.token.expiresAt
			})
		);
	},

	deny: async ({ url }) => {
		const { request } = await parse(url);
		if (!request) return fail(400, { error: 'This sign-in request is no longer valid.' });
		redirect(303, serverFor(url.origin).deny(request));
	}
};
