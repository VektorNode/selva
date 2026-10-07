import { describe, it, expect, vi } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { SupabaseDelegatedSession } from '../SupabaseDelegatedSession.js';

const URL_ = 'https://project.supabase.co';
const USER = '6f1d2c3b-1111-4222-8333-944455556666';

function es256Jwk(kid = 'kid-1') {
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	return {
		...privateKey.export({ format: 'jwk' }),
		kid,
		alg: 'ES256',
		key_ops: ['sign', 'verify']
	};
}

const accepting = () => vi.fn(async () => new Response('[]', { status: 200 }));

function decode(jwt: string) {
	const [h, p, s] = jwt.split('.');
	return {
		header: JSON.parse(Buffer.from(h!, 'base64url').toString()),
		payload: JSON.parse(Buffer.from(p!, 'base64url').toString()),
		input: `${h}.${p}`,
		signature: Buffer.from(s!, 'base64url')
	};
}

describe('SupabaseDelegatedSession', () => {
	it('signs ES256 with the key id and fixed claims', async () => {
		const jwk = es256Jwk();
		const now = 1_800_000_000_000;
		const session = new SupabaseDelegatedSession({
			supabaseUrl: `${URL_}/`,
			anonKey: 'anon',
			signingKey: JSON.stringify(jwk),
			fetch: accepting(),
			now: () => now
		});
		const { header, payload, input, signature } = decode(await session.mint(USER));

		expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'kid-1' });
		expect(payload).toEqual({
			sub: USER,
			role: 'authenticated',
			aud: 'authenticated',
			iat: now / 1000,
			exp: now / 1000 + 60,
			iss: `${URL_}/auth/v1`
		});
		const publicKey = createPublicKey({
			key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
			format: 'jwk'
		});
		expect(
			verify('sha256', Buffer.from(input), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)
		).toBe(true);
	});

	it('takes the signing key out of a signing_keys.json array', async () => {
		const session = new SupabaseDelegatedSession({
			supabaseUrl: URL_,
			anonKey: 'anon',
			signingKey: JSON.stringify([
				{ ...es256Jwk('old'), key_ops: ['verify'] },
				es256Jwk('current')
			]),
			fetch: accepting()
		});
		expect(decode(await session.mint(USER)).header.kid).toBe('current');
	});

	it('prefers the ES256 key over the legacy secret', async () => {
		const session = new SupabaseDelegatedSession({
			supabaseUrl: URL_,
			anonKey: 'anon',
			signingKey: JSON.stringify(es256Jwk()),
			jwtSecret: 'legacy',
			fetch: accepting()
		});
		expect(decode(await session.mint(USER)).header.alg).toBe('ES256');
	});

	it.each([
		['nothing configured', {}, /SUPABASE_JWT_SIGNING_KEY/],
		['invalid JSON', { signingKey: '{not json' }, /not valid JSON/],
		[
			'a public key',
			{ signingKey: JSON.stringify({ ...es256Jwk(), d: undefined }) },
			/private ES256/
		],
		['no kid', { signingKey: JSON.stringify({ ...es256Jwk(), kid: undefined }) }, /no "kid"/]
	])('turns tokens off with %s, without throwing at startup', async (_label, keys, message) => {
		const fetch = accepting();
		const session = new SupabaseDelegatedSession({
			supabaseUrl: URL_,
			anonKey: 'anon',
			fetch,
			...keys
		});
		const status = await session.status();
		expect(status.ok).toBe(false);
		expect(!status.ok && status.message).toMatch(message);
		await expect(session.mint(USER)).rejects.toMatchObject({ statusCode: 503 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('probes PostgREST once and remembers success', async () => {
		const fetch = accepting();
		const session = new SupabaseDelegatedSession({
			supabaseUrl: URL_,
			anonKey: 'anon',
			jwtSecret: 'secret',
			fetch
		});
		await session.mint(USER);
		await session.mint(USER);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${URL_}/rest/v1/orgs?select=id&limit=1`);
		expect((init.headers as Record<string, string>)['Accept-Profile']).toBe('selva');
	});

	it('names the fix when Supabase refuses the key, and re-checks later', async () => {
		let now = 0;
		const fetch = vi.fn(async () => new Response('{"code":"PGRST301"}', { status: 401 }));
		const session = new SupabaseDelegatedSession({
			supabaseUrl: URL_,
			anonKey: 'anon',
			signingKey: JSON.stringify(es256Jwk('standby')),
			fetch,
			now: () => now
		});
		const status = await session.status();
		expect(!status.ok && status.message).toMatch(/rejected .*kid standby.*rotate to it/);

		await session.status();
		expect(fetch).toHaveBeenCalledTimes(1);
		now += 31_000;
		fetch.mockResolvedValueOnce(new Response('[]', { status: 200 }));
		expect(await session.status()).toEqual({ ok: true });
	});

	it('reports an unreachable Supabase without throwing', async () => {
		const session = new SupabaseDelegatedSession({
			supabaseUrl: URL_,
			anonKey: 'anon',
			jwtSecret: 'secret',
			fetch: vi.fn(async () => {
				throw new Error('connect ECONNREFUSED');
			})
		});
		const status = await session.status();
		expect(!status.ok && status.message).toMatch(/Couldn't reach Supabase.*ECONNREFUSED/);
	});
});
