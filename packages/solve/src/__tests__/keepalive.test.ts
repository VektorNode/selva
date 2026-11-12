/**
 * Keep-alive solve responses, end to end: `respondWithKeepalive` on the server, `unwrapKeepalive`
 * in the client. The wire format itself is in `shared/keepalive.ts`.
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { respondWithKeepalive, wantsKeepalive } from '../server/keepalive.js';
import { unwrapKeepalive } from '../client/keepalive.js';
import { KEEPALIVE_PREFERENCE } from '../shared/keepalive.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('keep-alive solve response', () => {
	it('carries the real status, headers and body through a 200', async () => {
		const outer = respondWithKeepalive(
			Promise.resolve(
				new Response('{"message":"too large"}', {
					status: 413,
					headers: { 'Content-Type': 'application/json', 'Retry-After': '3' }
				})
			)
		);
		expect(outer.status).toBe(200);

		const inner = await unwrapKeepalive(outer);

		expect(inner.status).toBe(413);
		expect(inner.headers.get('Retry-After')).toBe('3');
		expect(await inner.json()).toEqual({ message: 'too large' });
	});

	it('sends spaces while the work runs, then the response', async () => {
		let finish: (res: Response) => void = () => {};
		const outer = respondWithKeepalive(new Promise<Response>((r) => (finish = r)), 5);

		await sleep(40);
		finish(new Response('{"values":[]}', { status: 200 }));
		const text = await outer.text();

		const [spaces] = /^ +/.exec(text) ?? [''];
		expect(spaces.length).toBeGreaterThan(2);
		expect(text.endsWith('{"values":[]}')).toBe(true);
	});

	it('unpacks a gzip body, which fetch left compressed inside the 200', async () => {
		const outer = respondWithKeepalive(
			Promise.resolve(
				new Response(gzipSync('{"a":1}'), {
					headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }
				})
			)
		);

		const inner = await unwrapKeepalive(outer);

		expect(inner.headers.get('Content-Encoding')).toBeNull();
		expect(await inner.json()).toEqual({ a: 1 });
	});

	it('returns a response the server sent without keep-alive as it is', async () => {
		const plain = new Response('{}', { status: 200 });
		expect(await unwrapKeepalive(plain)).toBe(plain);
	});

	it('rejects when the stream ends before the response', async () => {
		const cut = new Response('   ', { headers: { 'Preference-Applied': KEEPALIVE_PREFERENCE } });
		await expect(unwrapKeepalive(cut)).rejects.toThrow(/ended before/);
	});
});

describe('wantsKeepalive', () => {
	const request = (prefer?: string) =>
		new Request('http://x.test/api', { headers: prefer ? { Prefer: prefer } : {} });

	it('finds the token among other preferences', () => {
		expect(wantsKeepalive(request(`respond-async, ${KEEPALIVE_PREFERENCE}`))).toBe(true);
	});

	it('is false without it', () => {
		expect(wantsKeepalive(request('wait=10'))).toBe(false);
		expect(wantsKeepalive(request())).toBe(false);
	});
});
