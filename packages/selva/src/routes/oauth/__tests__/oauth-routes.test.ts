import { createHash } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { resolveApiToken } from '@selvajs/server/http';
import {
	actAs,
	freshProviders,
	grantPlatformPermissions,
	seedAcme,
	seedBigClient,
	seedOrgMember,
	seedProjectMember,
	seedUser,
	type TestProviders
} from '$lib/server/__tests__/fixtures';
import { apiTokenCodec } from '$lib/server/apiTokens/token.server';

const { POST: register } = await import('../register/+server');
const { POST: token } = await import('../token/+server');
const { GET: resourceMeta } =
	await import('../../.well-known/oauth-protected-resource/mcp/+server');
const { GET: serverMeta } = await import('../../.well-known/oauth-authorization-server/+server');
const { load, actions } = await import('../authorize/+page.server');

const ORIGIN = 'https://selva.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const LOOPBACK = 'http://127.0.0.1:53121/callback';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

// Route handlers read only these fields; the cast keeps each test to what it uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvent = any;

let tp: TestProviders;

afterEach(async () => {
	vi.restoreAllMocks();
	await tp?.cleanup();
});

function event(path: string, init: RequestInit & { locals?: object } = {}) {
	const url = new URL(ORIGIN + path);
	return {
		url,
		params: {},
		request: new Request(url, init),
		locals: init.locals ?? {},
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

function authorizeQuery(clientId: string, extra: Record<string, string> = {}) {
	return new URLSearchParams({
		client_id: clientId,
		redirect_uri: CALLBACK,
		response_type: 'code',
		code_challenge: CHALLENGE,
		code_challenge_method: 'S256',
		state: 'st',
		scope: 'read solve',
		resource: `${ORIGIN}/mcp`,
		...extra
	}).toString();
}

const pluginQuery = () =>
	authorizeQuery('selva-grasshopper', {
		redirect_uri: LOOPBACK,
		scope: 'upload',
		resource: ORIGIN
	});

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

function approve(query: string, locals: object, fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return actions.approve(
		event(`/oauth/authorize?${query}&/approve`, { method: 'POST', body: form, locals })
	);
}

function redeem(code: string, clientId: string, redirectUri: string, resource: string) {
	return token(
		event('/oauth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: clientId,
				redirect_uri: redirectUri,
				code_verifier: VERIFIER,
				resource
			}).toString()
		})
	);
}

async function resolveKey(raw: string) {
	vi.spyOn(tp.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	return resolveApiToken(
		new Request(`${ORIGIN}/api/v1/me`, { headers: { authorization: `Bearer ${raw}` } }),
		{ codec: apiTokenCodec(), auth: tp.config.auth, data: tp.config.data }
	);
}

/** Acme, plus Dana: a member who edits one project and holds no platform permission. */
async function world() {
	tp = await freshProviders();
	const acme = await seedAcme(tp);
	const dana = await seedUser(tp, 'dana@acme.test');
	await seedOrgMember(tp, { orgId: acme.acme.id, userId: dana.id, role: 'member' });
	await seedProjectMember(tp, { projectId: acme.acmeOrg.id, userId: dana.id, role: 'editor' });
	return { ...acme, dana };
}

describe('discovery', () => {
	it('serves protected resource metadata naming /mcp and this server', async () => {
		const res = await resourceMeta(event('/.well-known/oauth-protected-resource/mcp'));
		expect(await res.json()).toMatchObject({
			resource: `${ORIGIN}/mcp`,
			authorization_servers: [ORIGIN]
		});
	});

	it('gives the plugin what it checks before it opens a browser', async () => {
		const meta = await (await serverMeta(event('/.well-known/oauth-authorization-server'))).json();
		expect(meta).toMatchObject({
			issuer: ORIGIN,
			authorization_endpoint: `${ORIGIN}/oauth/authorize`,
			token_endpoint: `${ORIGIN}/oauth/token`
		});
		expect(meta.code_challenge_methods_supported).toContain('S256');
		expect(meta.scopes_supported).toContain('upload');
	});
});

describe('consent', () => {
	it('sends a signed-out user to login with the whole authorize query kept', async () => {
		await world();
		const query = authorizeQuery(await registeredClient());
		const to = await redirected(() => load(event(`/oauth/authorize?${query}`) as AnyEvent));
		expect(to.pathname).toBe('/login');
		expect(to.searchParams.get('redirectTo')).toBe(`/oauth/authorize?${query}`);
	});

	it('shows, never redirects, a request for an unregistered redirect URI', async () => {
		const w = await world();
		const bad = authorizeQuery(await registeredClient(), { redirect_uri: 'https://evil.test' });
		const data = await load(
			event(`/oauth/authorize?${bad}`, { locals: await actAs(tp, w.alice.id) }) as AnyEvent
		);
		expect(data).toMatchObject({ ok: false, problem: expect.stringContaining('not registered') });
	});

	it('re-renders the consent page, not an error, when approval fails', async () => {
		const w = await world();
		const query = authorizeQuery(await registeredClient());
		const locals = await actAs(tp, w.dana.id);
		// Dana may hold a read key but not a solve key: she has no manage_api_tokens.
		const failed = await approve(query, locals, { access: 'solve', orgId: w.acme.id });
		expect(failed).toMatchObject({
			status: 403,
			data: { error: expect.stringContaining('can’t') }
		});
		// SvelteKit then runs load on the action URL.
		const data = await load(event(`/oauth/authorize?${query}&/approve`, { locals }) as AnyEvent);
		expect(data).toMatchObject({ ok: true, clientName: 'Claude', builtIn: false });
		expect((data as { query: string }).query).not.toContain('/approve');
	});

	it('mints at consent through the core and hands the key over at the token endpoint', async () => {
		const w = await world();
		await grantPlatformPermissions(tp, w.alice.id, ['manage_api_tokens']);
		const clientId = await registeredClient();
		const query = authorizeQuery(clientId);
		const locals = await actAs(tp, w.alice.id);
		const back = await redirected(() =>
			approve(query, locals, { access: 'read', orgId: w.acme.id })
		);
		expect(back.origin + back.pathname).toBe(CALLBACK);
		expect(back.searchParams.get('iss')).toBe(ORIGIN);

		const res = await redeem(back.searchParams.get('code')!, clientId, CALLBACK, `${ORIGIN}/mcp`);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = (await res.json()) as { access_token: string; scope: string };
		expect(body.scope).toBe('read');

		const resolved = await resolveKey(body.access_token);
		expect(resolved).toMatchObject({ kind: 'ok' });
		if (resolved.kind === 'ok') {
			expect(resolved.token).toMatchObject({
				orgId: w.acme.id,
				scopes: ['read:all'],
				name: 'Claude (OAuth)'
			});
		}
	});

	it('offers only the access the user may hold somewhere', async () => {
		const w = await world();
		const query = authorizeQuery(await registeredClient(), { scope: 'read solve' });
		// Dana may hold a read key but not a solve key: she has no manage_api_tokens.
		const data = await load(
			event(`/oauth/authorize?${query}`, { locals: await actAs(tp, w.dana.id) }) as AnyEvent
		);
		expect(data).toMatchObject({ ok: true, choices: ['read'] });
	});

	it('never grants upload to a registered client', async () => {
		const w = await world();
		await grantPlatformPermissions(tp, w.alice.id, ['manage_api_tokens']);
		const query = authorizeQuery(await registeredClient(), { scope: 'read solve upload' });
		const data = await load(
			event(`/oauth/authorize?${query}`, { locals: await actAs(tp, w.alice.id) }) as AnyEvent
		);
		expect(data).toMatchObject({ ok: true, choices: ['read', 'solve'] });
		// A forged form field can't pick an access level the page didn't offer.
		const back = await redirected(async () =>
			approve(query, await actAs(tp, w.alice.id), { access: 'upload', orgId: w.acme.id })
		);
		const res = await redeem(
			back.searchParams.get('code')!,
			new URLSearchParams(query).get('client_id')!,
			CALLBACK,
			`${ORIGIN}/mcp`
		);
		expect(((await res.json()) as { scope: string }).scope).toBe('read');
	});
});

describe('the Grasshopper plugin', () => {
	it('signs in a designer without manage_api_tokens and gets an upload key', async () => {
		const w = await world();
		const locals = await actAs(tp, w.dana.id);
		const data = await load(event(`/oauth/authorize?${pluginQuery()}`, { locals }) as AnyEvent);
		expect(data).toMatchObject({
			ok: true,
			clientName: 'Selva for Grasshopper',
			builtIn: true,
			loopback: true,
			choices: ['upload'],
			orgs: [{ id: w.acme.id, name: 'Acme' }]
		});

		const back = await redirected(() =>
			approve(pluginQuery(), locals, { access: 'upload', orgId: w.acme.id })
		);
		expect(back.origin + back.pathname).toBe('http://127.0.0.1:53121/callback');
		expect(back.searchParams.get('state')).toBe('st');
		expect(back.searchParams.get('iss')).toBe(ORIGIN);

		const res = await redeem(back.searchParams.get('code')!, 'selva-grasshopper', LOOPBACK, ORIGIN);
		const body = (await res.json()) as {
			access_token: string;
			token_type: string;
			scope: string;
			expires_in: number;
		};
		expect(body).toMatchObject({ token_type: 'Bearer', scope: 'upload' });
		expect(body.expires_in).toBeGreaterThan(29 * 86_400);
		const resolved = await resolveKey(body.access_token);
		expect(resolved).toMatchObject({ kind: 'ok' });
		if (resolved.kind === 'ok') expect(resolved.token.scopes).toEqual(['upload:all']);
	});

	it('tells someone who can upload nowhere that they can’t connect', async () => {
		const w = await world();
		const data = await load(
			event(`/oauth/authorize?${pluginQuery()}`, {
				locals: await actAs(tp, w.bob.id)
			}) as AnyEvent
		);
		expect(data).toMatchObject({ ok: false });
	});

	it.each(['http://localhost:53121/callback', 'http://127.0.0.1:53121/cb', 'https://evil.test/'])(
		'refuses the redirect %s on the page itself',
		async (redirectUri) => {
			const w = await world();
			const query = authorizeQuery('selva-grasshopper', {
				redirect_uri: redirectUri,
				scope: 'upload'
			});
			const data = await load(
				event(`/oauth/authorize?${query}`, { locals: await actAs(tp, w.dana.id) }) as AnyEvent
			);
			expect(data).toMatchObject({ ok: false, problem: expect.stringContaining('not registered') });
		}
	);
});

describe('the org picker', () => {
	async function twoOrgs() {
		const w = await world();
		const big = await seedBigClient(tp);
		await seedOrgMember(tp, { orgId: big.bigClient.id, userId: w.dana.id, role: 'member' });
		await grantPlatformPermissions(tp, w.dana.id, ['manage_api_tokens']);
		return { ...w, big };
	}

	it('offers every org the user may hold the key in, and mints in the one they pick', async () => {
		const w = await twoOrgs();
		const locals = await actAs(tp, w.dana.id);
		const data = (await load(
			event(`/oauth/authorize?${pluginQuery()}`, { locals }) as AnyEvent
		)) as { orgs: { id: string }[]; orgId: string };
		expect(data.orgs.map((o) => o.id).sort()).toEqual([w.acme.id, w.big.bigClient.id].sort());
		expect(data.orgId).toBe(locals.ctx.actingOrgId);

		const other = data.orgs.find((o) => o.id !== locals.ctx.actingOrgId)!.id;
		const back = await redirected(() =>
			approve(pluginQuery(), locals, { access: 'upload', orgId: other })
		);
		const res = await redeem(back.searchParams.get('code')!, 'selva-grasshopper', LOOPBACK, ORIGIN);
		const resolved = await resolveKey(
			((await res.json()) as { access_token: string }).access_token
		);
		expect(resolved).toMatchObject({ kind: 'ok' });
		if (resolved.kind === 'ok') expect(resolved.token.orgId).toBe(other);
	});

	it('refuses an org the user doesn’t belong to, and mints nothing', async () => {
		const w = await twoOrgs();
		const outsider = await seedUser(tp, 'olga@acme.test');
		await seedOrgMember(tp, { orgId: w.acme.id, userId: outsider.id, role: 'admin' });
		await grantPlatformPermissions(tp, outsider.id, ['manage_api_tokens']);
		const failed = await approve(pluginQuery(), await actAs(tp, outsider.id), {
			access: 'upload',
			orgId: w.big.bigClient.id
		});
		expect(failed).toMatchObject({ status: 403 });
		const minted = await tp.config.data.apiTokens!.listByOrg(SYSTEM_CONTEXT, w.big.bigClient.id);
		expect(minted.items).toEqual([]);
	});
});
