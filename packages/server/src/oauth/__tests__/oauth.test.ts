import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { createOAuthServer, OAuthError } from '../index.js';

const ORIGIN = 'https://selva.test';
const SECRET = 's'.repeat(32);

function server(overrides: Partial<Parameters<typeof createOAuthServer>[0]> = {}) {
	return createOAuthServer({ origin: ORIGIN, secret: SECRET, ...overrides });
}

describe('dynamic client registration', () => {
	it('registers a client without storing it, and resolves it back', async () => {
		const oauth = server();
		const res = oauth.register({
			client_name: 'Claude',
			redirect_uris: ['https://claude.ai/api/mcp/auth_callback']
		});
		expect(res.status).toBe(201);
		const client = await oauth.resolveClient(res.body.client_id as string);
		expect(client).toEqual({
			clientId: res.body.client_id,
			name: 'Claude',
			redirectUris: ['https://claude.ai/api/mcp/auth_callback']
		});
	});

	it('refuses a client id this server did not sign', async () => {
		const oauth = server();
		const { body } = oauth.register({ redirect_uris: ['https://a.test/cb'] });
		const forged = (body.client_id as string).replace(/\.[^.]+$/, '.AAAA');
		await expect(oauth.resolveClient(forged)).rejects.toThrow(OAuthError);
	});

	it('refuses redirect URIs that are neither https nor loopback', () => {
		const res = server().register({ redirect_uris: ['http://evil.test/cb'] });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('invalid_redirect_uri');
	});
});

describe('client ID metadata documents', () => {
	const URL_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
	const doc = {
		client_id: URL_ID,
		client_name: 'Claude Code',
		redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback']
	};

	it('reads the document once and caches it', async () => {
		let fetched = 0;
		const oauth = server({ fetchClientMetadata: async () => (fetched++, doc) });
		const client = await oauth.resolveClient(URL_ID);
		await oauth.resolveClient(URL_ID);
		expect(client).toMatchObject({ name: 'Claude Code', redirectUris: doc.redirect_uris });
		expect(fetched).toBe(1);
	});

	it('refuses a document that names another client', async () => {
		const oauth = server({ fetchClientMetadata: async () => ({ ...doc, client_id: 'https://x' }) });
		await expect(oauth.resolveClient(URL_ID)).rejects.toThrow(/different client_id/);
	});

	it('refuses URL client ids when the host gave no fetcher', async () => {
		await expect(server().resolveClient(URL_ID)).rejects.toThrow(OAuthError);
	});
});

// ============================================================================
// The whole flow: authorize, consent, token
// ============================================================================

const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const GRANT = {
	tokenId: 't1',
	secret: 'selva_raw',
	scopes: ['read', 'solve'] as ('read' | 'solve')[],
	expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString()
};

async function authorized(oauth = server(), extra: Record<string, string> = {}) {
	const { body } = oauth.register({
		client_name: 'Claude',
		redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1/callback']
	});
	const clientId = body.client_id as string;
	const request = await oauth.parseAuthorizeRequest(
		new URLSearchParams({
			client_id: clientId,
			redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
			response_type: 'code',
			code_challenge: CHALLENGE,
			code_challenge_method: 'S256',
			state: 'st',
			resource: `${ORIGIN}/mcp`,
			...extra
		})
	);
	return { oauth, clientId, request };
}

function tokenForm(clientId: string, code: string, overrides: Record<string, string> = {}) {
	return new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		client_id: clientId,
		redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
		code_verifier: VERIFIER,
		resource: `${ORIGIN}/mcp`,
		...overrides
	});
}

describe('authorize', () => {
	it('accepts a loopback redirect on any port, and nothing else unregistered', async () => {
		const { oauth, clientId } = await authorized();
		const base = {
			client_id: clientId,
			response_type: 'code',
			code_challenge: CHALLENGE,
			code_challenge_method: 'S256'
		};
		await expect(
			oauth.parseAuthorizeRequest(
				new URLSearchParams({ ...base, redirect_uri: 'http://127.0.0.1:53121/callback' })
			)
		).resolves.toMatchObject({ redirectUri: 'http://127.0.0.1:53121/callback' });
		await expect(
			oauth.parseAuthorizeRequest(
				new URLSearchParams({ ...base, redirect_uri: 'https://evil.test/cb' })
			)
		).rejects.toThrow(/not registered/);
	});

	it('requires S256 PKCE and a resource that is this server', async () => {
		await expect(authorized(server(), { code_challenge_method: 'plain' })).rejects.toThrow(/S256/);
		await expect(authorized(server(), { resource: 'https://other.test/mcp' })).rejects.toThrow(
			/not this server/
		);
	});

	it('narrows to the scopes asked for, and asks for all when none are named', async () => {
		expect((await authorized(server(), { scope: 'read' })).request.scopes).toEqual(['read']);
		expect((await authorized()).request.scopes).toEqual(['read', 'solve']);
	});

	it('redirects a denial with access_denied, the state and the issuer', async () => {
		const { oauth, request } = await authorized();
		const url = new URL(oauth.deny(request));
		expect(Object.fromEntries(url.searchParams)).toEqual({
			error: 'access_denied',
			state: 'st',
			iss: ORIGIN
		});
	});
});

describe('token exchange', () => {
	it('hands over the minted key once, for the right verifier', async () => {
		const { oauth, clientId, request } = await authorized();
		const redirect = new URL(oauth.approve(request, GRANT));
		expect(redirect.searchParams.get('state')).toBe('st');
		expect(redirect.searchParams.get('iss')).toBe(ORIGIN);
		const code = redirect.searchParams.get('code')!;
		expect(code).not.toContain('selva_raw');

		const res = oauth.exchange(tokenForm(clientId, code));
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			access_token: 'selva_raw',
			token_type: 'Bearer',
			scope: 'read solve'
		});
		expect(res.body.expires_in).toBeGreaterThan(29 * 86_400);

		const again = oauth.exchange(tokenForm(clientId, code));
		expect(again.body.error).toBe('invalid_grant');
	});

	it('refuses a wrong verifier, client or redirect URI', async () => {
		const { oauth, clientId, request } = await authorized();
		const code = new URL(oauth.approve(request, GRANT)).searchParams.get('code')!;
		const wrong: Record<string, string>[] = [
			{ code_verifier: 'w'.repeat(64) },
			{ client_id: 'dcr_other' },
			{ redirect_uri: 'http://127.0.0.1/callback' }
		];
		for (const bad of wrong) {
			expect(oauth.exchange(tokenForm(clientId, code, bad)).body.error).toBe('invalid_grant');
		}
		// None of those spent the code.
		expect(oauth.exchange(tokenForm(clientId, code)).status).toBe(200);
	});

	it('refuses an expired code', async () => {
		let t = Date.now();
		const oauth = server({ now: () => t });
		const { clientId, request } = await authorized(oauth);
		const code = new URL(oauth.approve(request, GRANT)).searchParams.get('code')!;
		t += 61_000;
		expect(oauth.exchange(tokenForm(clientId, code)).body.error).toBe('invalid_grant');
	});

	it('refuses a code from another instance', async () => {
		const { oauth, clientId, request } = await authorized();
		const code = new URL(oauth.approve(request, GRANT)).searchParams.get('code')!;
		const other = createOAuthServer({ origin: ORIGIN, secret: 'o'.repeat(32) });
		expect(other.exchange(tokenForm(clientId, code)).body.error).toBe('invalid_grant');
	});

	it('names an unsupported grant type', () => {
		const res = server().exchange(new URLSearchParams({ grant_type: 'refresh_token' }));
		expect(res.body.error).toBe('unsupported_grant_type');
	});
});

describe('discovery', () => {
	it('advertises what Claude needs to pick CIMD and PKCE', () => {
		const meta = server().authorizationServerMetadata();
		expect(meta).toMatchObject({
			issuer: ORIGIN,
			client_id_metadata_document_supported: true,
			token_endpoint_auth_methods_supported: ['none'],
			code_challenge_methods_supported: ['S256'],
			authorization_response_iss_parameter_supported: true
		});
		expect(server().protectedResourceMetadata()).toEqual({
			resource: `${ORIGIN}/mcp`,
			authorization_servers: [ORIGIN],
			scopes_supported: ['read', 'solve'],
			bearer_methods_supported: ['header']
		});
	});
});
