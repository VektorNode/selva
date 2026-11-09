/**
 * A host that hands registered clients `write`: the whole sign-in, from
 * registration to a key the API lets write, through the real consent handlers.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { scopeAllows } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	actAs,
	callHandler,
	grantPlatformPermissions,
	seedAcme,
	seedAcmeDesigner,
	type ActingLocals
} from '../../testing/index.js';
import type { ApiRequest } from '../../api/index.js';
import { createApiTokenCodec } from '../../tokens/index.js';
import { resolveApiToken } from '../../http/index.js';
import { apiScopesFor, createOAuthServer, type OAuthServer } from '../../oauth/index.js';
import { consentOffer, mintConsentToken, type ConsentOffer } from '../oauthConsent.js';
import type { MintedApiToken } from '../apiTokens.js';

const ORIGIN = 'https://host.test';
const REDIRECT = 'https://agent.test/callback';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const codec = createApiTokenCodec('k'.repeat(32));

let h: HandlerHarness | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	await h?.cleanup();
	h = null;
});

async function world() {
	h = await freshHarness();
	h.deps = { ...h.deps, tokens: { ...h.deps?.tokens, apiTokens: codec } };
	const acme = await seedAcme(h);
	return { ...acme, h, dana: await seedAcmeDesigner(h, acme) };
}

async function run<T>(locals: ActingLocals, fn: (req: ApiRequest) => Promise<T>): Promise<T> {
	const res = await callHandler(async (req) => ({ body: await fn(req) }), { locals });
	expect(res.status).toBe(200);
	return res.json as T;
}

async function authorize(oauth: OAuthServer, scope: string) {
	const { body } = oauth.register({ client_name: 'Drafts agent', redirect_uris: [REDIRECT] });
	const clientId = body.client_id as string;
	const request = await oauth.parseAuthorizeRequest(
		new URLSearchParams({
			client_id: clientId,
			redirect_uri: REDIRECT,
			response_type: 'code',
			code_challenge: CHALLENGE,
			code_challenge_method: 'S256',
			scope,
			state: 'st'
		})
	);
	return { clientId, request };
}

describe('a host that grants registered clients write', () => {
	const oauth = () =>
		createOAuthServer({
			origin: ORIGIN,
			secret: 's'.repeat(32),
			registeredClientScopes: ['read', 'solve', 'write']
		});

	it('signs a client in with change access, and the key it gets may write but not solve', async () => {
		const w = await world();
		await grantPlatformPermissions(w.h, w.alice.id, ['manage_api_tokens']);
		const locals = await actAs(w.h, w.alice.id);
		const server = oauth();
		const { clientId, request } = await authorize(server, 'read solve write');
		expect(request.scopes).toEqual(['read', 'solve', 'write']);

		const offer = await run(locals, (req) => consentOffer(req, request.scopes));
		expect(offer?.levels.map((l) => l.choice.access)).toEqual([
			'read',
			'solve',
			'write',
			'write_and_solve'
		]);

		const choice = offer!.levels.find((l) => l.choice.access === 'write')!.choice;
		const minted = await run<MintedApiToken>(locals, (req) =>
			mintConsentToken(req, w.acme.id, {
				name: 'Drafts agent (OAuth)',
				scopes: apiScopesFor(choice.scopes),
				expiresInDays: 30
			})
		);
		expect(minted.token.scopes).toEqual(['read:all', 'write:all']);

		const code = new URL(
			server.approve(request, {
				tokenId: minted.token.id,
				secret: minted.secret,
				scopes: choice.scopes,
				expiresAt: minted.token.expiresAt
			})
		).searchParams.get('code')!;
		const exchanged = server.exchange(
			new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: clientId,
				redirect_uri: REDIRECT,
				code_verifier: VERIFIER,
				resource: `${ORIGIN}/mcp`
			})
		);
		expect(exchanged.status).toBe(200);
		expect(exchanged.body).toMatchObject({ token_type: 'Bearer', scope: 'read write' });

		// What /api/v1 checks against each route's `x-scope`.
		vi.spyOn(w.h.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
		const resolved = await resolveApiToken(
			new Request(`${ORIGIN}/api/v1/projects`, {
				headers: { authorization: `Bearer ${exchanged.body.access_token as string}` }
			}),
			{ codec, auth: w.h.config.auth, data: w.h.config.data }
		);
		if (resolved.kind !== 'ok') throw new Error(`key rejected: ${JSON.stringify(resolved)}`);
		expect(scopeAllows(resolved.ctx, 'write')).toBe(true);
		expect(scopeAllows(resolved.ctx, 'read')).toBe(true);
		expect(scopeAllows(resolved.ctx, 'solve')).toBe(false);
	});

	it('offers only what the user may hold: read, for someone without manage_api_tokens', async () => {
		const w = await world();
		const { request } = await authorize(oauth(), 'read solve write');
		const offer = await run<ConsentOffer | null>(await actAs(w.h, w.dana.id), (req) =>
			consentOffer(req, request.scopes)
		);
		expect(offer?.levels.map((l) => l.choice.access)).toEqual(['read']);
	});

	it('never reaches write on the default server, whatever the client asks', async () => {
		const w = await world();
		await grantPlatformPermissions(w.h, w.alice.id, ['manage_api_tokens']);
		const { request } = await authorize(
			createOAuthServer({ origin: ORIGIN, secret: 's'.repeat(32) }),
			'read solve write'
		);
		expect(request.scopes).toEqual(['read', 'solve']);
		const offer = await run<ConsentOffer | null>(await actAs(w.h, w.alice.id), (req) =>
			consentOffer(req, request.scopes)
		);
		expect(offer?.levels.map((l) => l.choice.access)).toEqual(['read', 'solve']);
	});
});
