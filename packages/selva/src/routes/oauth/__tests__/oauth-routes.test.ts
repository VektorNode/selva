import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { SELVA_HMAC_KEY: 'test-secret-that-is-at-least-32-chars-long' }
}));
vi.mock('$lib/server/providers.server', () => ({
	providers: { data: { orgs: { getOrg: async () => ({ name: 'Acme' }) } } }
}));

const { POST: register } = await import('../register/+server');
const { POST: token } = await import('../token/+server');
const { GET: resourceMeta } =
	await import('../../.well-known/oauth-protected-resource/mcp/+server');
const { load, actions } = await import('../authorize/+page.server');

const ORIGIN = 'https://selva.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

// Route handlers read only these fields; the cast keeps each test to what it uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvent = any;

function event(path: string, init: RequestInit & { locals?: object; fetch?: typeof fetch } = {}) {
	const url = new URL(ORIGIN + path);
	return {
		url,
		request: new Request(url, init),
		locals: init.locals ?? {},
		fetch: init.fetch ?? fetch,
		getClientAddress: () => '203.0.113.7'
	} as AnyEvent;
}

async function registeredClient(): Promise<string> {
	const res = await register(
		event('/oauth/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] })
		})
	);
	expect(res.status).toBe(201);
	return ((await res.json()) as { client_id: string }).client_id;
}

function authorizeQuery(clientId: string) {
	return new URLSearchParams({
		client_id: clientId,
		redirect_uri: CALLBACK,
		response_type: 'code',
		code_challenge: CHALLENGE,
		code_challenge_method: 'S256',
		state: 'st',
		scope: 'read solve',
		resource: `${ORIGIN}/mcp`
	}).toString();
}

/** What SvelteKit's `redirect()` throws: the status and location. */
async function redirected(run: () => unknown): Promise<URL> {
	try {
		await run();
	} catch (err) {
		const r = err as { status?: number; location?: string };
		if (r.status === 303 && r.location) return new URL(r.location, ORIGIN);
		throw err;
	}
	throw new Error('expected a redirect');
}

const signedIn = {
	user: { id: 'u1' },
	ctx: {
		userId: 'u1',
		actingOrgId: 'o1',
		orgPermissions: [],
		platformPermissions: ['manage_api_tokens']
	}
};

describe('OAuth routes', () => {
	it('serves protected resource metadata naming /mcp and this server', async () => {
		const res = await resourceMeta(event('/.well-known/oauth-protected-resource/mcp'));
		expect(await res.json()).toMatchObject({
			resource: `${ORIGIN}/mcp`,
			authorization_servers: [ORIGIN]
		});
	});

	it('sends a signed-out user to login with the whole authorize query kept', async () => {
		const query = authorizeQuery(await registeredClient());
		const to = await redirected(() => load(event(`/oauth/authorize?${query}`) as AnyEvent));
		expect(to.pathname).toBe('/login');
		expect(to.searchParams.get('redirectTo')).toBe(`/oauth/authorize?${query}`);
	});

	it('shows, never redirects, a request for an unregistered redirect URI', async () => {
		const clientId = await registeredClient();
		const bad = authorizeQuery(clientId).replace(
			encodeURIComponent(CALLBACK),
			'https%3A%2F%2Fevil.test'
		);
		const data = await load(event(`/oauth/authorize?${bad}`, { locals: signedIn }) as AnyEvent);
		expect(data).toMatchObject({ ok: false, problem: expect.stringContaining('not registered') });
	});

	it('re-renders the consent page, not an error, when approval fails', async () => {
		const query = `?${authorizeQuery(await registeredClient())}`;
		const refused = (async () =>
			Response.json(
				{ message: 'You can’t create API tokens in this org.' },
				{ status: 403 }
			)) as typeof fetch;
		const form = new FormData();
		form.set('access', 'solve');
		const actionUrl = `/oauth/authorize${query}&/approve`;
		const failed = await actions.approve(
			event(actionUrl, { method: 'POST', body: form, locals: signedIn, fetch: refused })
		);
		expect(failed).toMatchObject({
			status: 403,
			data: { error: expect.stringContaining('can’t') }
		});
		// SvelteKit then runs load on the action URL.
		const data = await load(event(actionUrl, { locals: signedIn }) as AnyEvent);
		expect(data).toMatchObject({ ok: true, clientName: 'Claude' });
		expect((data as { query: string }).query).not.toContain('/approve');
	});

	it('mints a token at consent and hands it over at the token endpoint', async () => {
		const query = `?${authorizeQuery(await registeredClient())}`;
		const minted: { url: string; body: unknown }[] = [];
		const fakeFetch = (async (url: string, init: RequestInit) => {
			minted.push({ url, body: JSON.parse(init.body as string) });
			return Response.json(
				{
					token: { id: 't1', expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
					secret: 'selva_minted'
				},
				{ status: 201 }
			);
		}) as typeof fetch;

		const form = new FormData();
		form.set('access', 'read');
		const back = await redirected(() =>
			actions.approve(
				event(`/oauth/authorize${query}&/approve`, {
					method: 'POST',
					body: form,
					locals: signedIn,
					fetch: fakeFetch
				})
			)
		);
		expect(minted[0]).toEqual({
			url: '/api/v1/orgs/o1/tokens',
			body: { name: 'Claude (OAuth)', scopes: ['read:all'], expiresInDays: 30 }
		});
		expect(back.origin + back.pathname).toBe(CALLBACK);
		expect(back.searchParams.get('iss')).toBe(ORIGIN);

		const clientId = new URLSearchParams(query).get('client_id')!;
		const res = await token(
			event('/oauth/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: back.searchParams.get('code')!,
					client_id: clientId,
					redirect_uri: CALLBACK,
					code_verifier: VERIFIER
				}).toString()
			})
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toMatchObject({ access_token: 'selva_minted', scope: 'read' });
	});
});
