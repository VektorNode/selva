import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequestTiming, parseServerTimingHeader } from '../request-timing.js';

afterEach(() => vi.restoreAllMocks());

const req = { method: 'GET', route: '/s/[token]' };

function timing(opts: { slowMs?: number; sampleRate?: number } = {}) {
	const lines: { message: string; fields: Record<string, unknown> }[] = [];
	const t = createRequestTiming({
		log: (message, fields) => lines.push({ message, fields }),
		upstream: (url) =>
			url.pathname.startsWith('/rest/') ? { key: 'db', target: 'db x' } : undefined,
		labels: { revision: 'r1' },
		sampleRate: 0,
		...opts
	});
	return { t, lines };
}

describe('parseServerTimingHeader', () => {
	it('reads durations and desc-only entries', () => {
		expect(parseServerTimingHeader('solve;dur=12.4, cache;desc=hit')).toEqual({
			solve: 12,
			cache: 'hit'
		});
	});
});

describe('createRequestTiming', () => {
	it('logs the first request as cold, with the boot time, and labels every record', async () => {
		const { t, lines } = timing({ slowMs: 10_000 });
		t.markBooted();
		let cold = false;
		await t.timeRequest(req, async () => {
			cold = t.isCold();
			return new Response('ok');
		});
		await t.timeRequest(req, async () => new Response('ok'));

		expect(cold).toBe(true);
		expect(lines.map((l) => l.message.split(' ')[0])).toEqual(['[coldstart]', '[timing]']);
		expect(lines[0].fields).toMatchObject({
			revision: 'r1',
			instance: expect.any(String),
			coldstart: { bootMs: expect.any(Number), route: '/s/[token]' }
		});
		expect(lines[1].fields.timing).toMatchObject({ cold: true, status: 200 });
	});

	it('logs a fast request only when sampled, and marks it', async () => {
		const { t, lines } = timing({ slowMs: 10_000, sampleRate: 1 });
		await t.timeRequest(req, async () => new Response('ok'));
		await t.timeRequest(req, async () => new Response('ok'));
		expect(lines.at(-1)?.fields.timing).toMatchObject({ sampled: true });
	});

	it('buckets fetches by upstream with a per-call median, and stamps Server-Timing', async () => {
		const { t, lines } = timing({ slowMs: 0 });
		const real = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response('{}', { headers: { 'Server-Timing': 'gh;dur=40' } })) as typeof fetch;
		try {
			t.instrumentFetch();
			const res = await t.timeRequest(req, async () => {
				await fetch('https://db.example/rest/v1/x');
				await fetch('https://db.example/rest/v1/x');
				await t.span('render', () => 1);
				t.fact({ size: 3 });
				return new Response('ok');
			});
			expect(res.headers.get('Server-Timing')).toMatch(/app_render;dur=[\d.]+, up;desc="db x2"/);
		} finally {
			globalThis.fetch = real;
		}
		const record = lines.at(-1)?.fields.timing as Record<string, unknown>;
		expect(record).toMatchObject({
			upstream: { db: { count: 2, p50: expect.any(Number), max: expect.any(Number) } },
			calls: { 'db x': 2 },
			spans: { render: expect.any(Number) },
			size: 3,
			upstreamTiming: { '/rest/v1/x': { gh: 40 } }
		});
	});

	it('never lets a failing log fail the request', async () => {
		const t = createRequestTiming({
			log: () => {
				throw new Error('sink down');
			},
			slowMs: 0
		});
		await expect(t.timeRequest(req, async () => new Response('ok'))).resolves.toBeInstanceOf(
			Response
		);
	});
});
