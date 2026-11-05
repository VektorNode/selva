/**
 * ComputeServerStats against the rhino.compute proxy front. Pins the endpoints'
 * contracts (verified against VektorNode/compute.rhino3d@Compute8) and the
 * failure modes:
 *
 *   GET /                    -> 200 "compute.rhino3d running" (proxy liveness root).
 *   GET /activechildren      -> plain-text integer (proxy writes ActiveComputeCount).
 *   GET /version             -> { rhino, compute, git_sha } lowercase (proxied to a child).
 *   GET /limits              -> { timeoutSeconds, maxRequestBytes, signalsStaleDefinition } (fork only).
 *   GET /plugins/*\/installed -> { name: version } map of non-core plugins.
 *
 * The client must DEGRADE GRACEFULLY on every failure (return null/false, never
 * throw) so a flaky monitor never crashes the caller — these tests pin exactly
 * that, plus that the RhinoComputeKey header is sent when an apiKey is set.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import ComputeServerStats from '../compute-server-stats';
import { classifyProbeFailure } from '@/core/server/classify-probe-failure';
import type { ComputeError } from '@/core/errors';
import { setLogger } from '@/core/utils/logger';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const SERVER = 'http://localhost:6500';

afterEach(() => fetchMock.mockReset());

/** A minimal mock Response with text()/ok/status/headers. */
function res(body: string, init: { ok?: boolean; status?: number } = {}): Response {
	const { ok = true, status = 200 } = init;
	return {
		ok,
		status,
		statusText: ok ? 'OK' : 'Error',
		headers: new Headers(),
		text: async () => body,
		json: async () => JSON.parse(body)
	} as Response;
}

/** Route fetch by URL suffix; unmatched rejects so gaps are loud. */
function route(handlers: Record<string, () => Response>) {
	fetchMock.mockImplementation((url: string) => {
		for (const [suffix, make] of Object.entries(handlers)) {
			if (url.endsWith(suffix)) return Promise.resolve(make());
		}
		return Promise.reject(new Error(`unrouted fetch: ${url}`));
	});
}

describe('isServerOnline', () => {
	it('is true when GET / is 200', async () => {
		fetchMock.mockResolvedValue(res('compute.rhino3d running'));
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.isServerOnline()).resolves.toBe(true);
		await stats.dispose();
	});

	it('is false when GET / is non-2xx', async () => {
		fetchMock.mockResolvedValue(res('', { ok: false, status: 503 }));
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.isServerOnline()).resolves.toBe(false);
		await stats.dispose();
	});

	it('is false (not throwing) when the network rejects', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'));
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.isServerOnline()).resolves.toBe(false);
		await stats.dispose();
	});
});

describe('probeServer', () => {
	it('reports the HTTP status when the server answers non-2xx (e.g. auth rejection)', async () => {
		fetchMock.mockResolvedValue(res('unauthorized', { ok: false, status: 401 }));
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.probeServer()).resolves.toEqual({ online: false, status: 401 });
		await stats.dispose();
	});

	it('reads a redirect from `/` as online without following it', async () => {
		fetchMock.mockResolvedValue(res('', { ok: false, status: 302 }));
		const stats = new ComputeServerStats(SERVER, 'key');
		await expect(stats.probeServer()).resolves.toEqual({ online: true, status: 302 });
		expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
		await stats.dispose();
	});

	it('reads an opaque redirect (browser fetch) as online', async () => {
		fetchMock.mockResolvedValue({ ...res('', { ok: false, status: 0 }), type: 'opaqueredirect' });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.probeServer()).resolves.toEqual({ online: true, status: 0 });
		await stats.dispose();
	});

	it('reports the connection error when the network rejects', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'));
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.probeServer()).resolves.toEqual({
			online: false,
			error: 'TypeError: fetch failed'
		});
		await stats.dispose();
	});
});

describe('getInstalledPlugins', () => {
	it('returns the gh inventory by default', async () => {
		route({
			'/plugins/gh/installed': () => res(JSON.stringify({ Selva: '1.4.0', Pufferfish: '3.0' }))
		});
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getInstalledPlugins()).resolves.toEqual({
			Selva: '1.4.0',
			Pufferfish: '3.0'
		});
		await stats.dispose();
	});

	it('hits /plugins/rhino/installed when kind is "rhino"', async () => {
		route({ '/plugins/rhino/installed': () => res(JSON.stringify({ Bongo: '8.0' })) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getInstalledPlugins('rhino')).resolves.toEqual({ Bongo: '8.0' });
		await stats.dispose();
	});

	it('returns null on a non-JSON body', async () => {
		route({ '/plugins/gh/installed': () => res('not json') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getInstalledPlugins()).resolves.toBeNull();
		await stats.dispose();
	});
});

describe('getActiveChildren', () => {
	it('parses the plain-text integer body', async () => {
		route({ '/activechildren': () => res('3') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getActiveChildren()).resolves.toBe(3);
		await stats.dispose();
	});

	it('handles whitespace around the count', async () => {
		route({ '/activechildren': () => res('  5\n') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getActiveChildren()).resolves.toBe(5);
		await stats.dispose();
	});

	it('appends ?initialize=false for a passive read (no spawn)', async () => {
		route({ '/activechildren?initialize=false': () => res('2') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getActiveChildren({ initialize: false })).resolves.toBe(2);
		await stats.dispose();
	});

	// parseInt would read "302 Found…" as 302 children: a redirect/error page
	// must be rejected, not fed into purgeAllChildren.
	it.each(['not-a-number', '302 Found - redirecting', '2.5'])(
		'returns null for the body %j',
		async (body) => {
			route({ '/activechildren': () => res(body) });
			const stats = new ComputeServerStats(SERVER);
			await expect(stats.getActiveChildren()).resolves.toBeNull();
			await stats.dispose();
		}
	);
});

describe('getLimits', () => {
	it('reads the fork shape', async () => {
		route({
			'/limits': () =>
				res(
					JSON.stringify({
						timeoutSeconds: 1800,
						maxRequestBytes: 52428800,
						signalsStaleDefinition: true
					})
				)
		});
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getLimits()).resolves.toEqual({
			timeoutSeconds: 1800,
			maxRequestBytes: 52428800,
			signalsStaleDefinition: true
		});
		await stats.dispose();
	});

	it('is null on a server without the route', async () => {
		route({ '/limits': () => res('', { ok: false, status: 404 }) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getLimits()).resolves.toBeNull();
		await stats.dispose();
	});

	it('is null when a limit is missing or not positive', async () => {
		for (const body of [
			'not json',
			JSON.stringify({ timeoutSeconds: 0, maxRequestBytes: 1 }),
			JSON.stringify({ maxRequestBytes: 1 })
		]) {
			route({ '/limits': () => res(body) });
			const stats = new ComputeServerStats(SERVER);
			await expect(stats.getLimits()).resolves.toBeNull();
			await stats.dispose();
		}
	});
});

describe('getVersion', () => {
	it('reads the lowercase { rhino, compute, git_sha } shape', async () => {
		route({
			'/version': () =>
				res(JSON.stringify({ rhino: '8.0.23304', compute: '1.2.3', git_sha: 'abc123' }))
		});
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getVersion()).resolves.toEqual({
			rhino: '8.0.23304',
			compute: '1.2.3',
			git_sha: 'abc123'
		});
		await stats.dispose();
	});

	it('tolerates a null git_sha (server sends git_sha: null)', async () => {
		route({
			'/version': () => res(JSON.stringify({ rhino: '8.0', compute: '1.0', git_sha: null }))
		});
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getVersion()).resolves.toEqual({
			rhino: '8.0',
			compute: '1.0',
			git_sha: null
		});
		await stats.dispose();
	});

	it('falls back to raw text when the body is not JSON', async () => {
		route({ '/version': () => res('8.0.0-plain') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getVersion()).resolves.toEqual({
			rhino: '8.0.0-plain',
			compute: '',
			git_sha: null
		});
		await stats.dispose();
	});
});

describe('API key header', () => {
	it('sends RhinoComputeKey only when an apiKey is configured', async () => {
		route({ '/version': () => res(JSON.stringify({ rhino: '8', compute: '1', git_sha: null })) });
		const keyed = new ComputeServerStats(SERVER, 'secret-key');
		const keyless = new ComputeServerStats(SERVER);
		await keyed.getVersion();
		await keyless.getVersion();
		const sent = fetchMock.mock.calls.map(([, init]) =>
			new Headers((init as RequestInit).headers).get('RhinoComputeKey')
		);
		expect(sent).toEqual(['secret-key', null]);
		await keyed.dispose();
		await keyless.dispose();
	});

	it('sends the same auth headers a solve would when given ComputeConfig auth fields', async () => {
		route({ '/version': () => res(JSON.stringify({ rhino: '8', compute: '1', git_sha: null })) });
		const stats = new ComputeServerStats(SERVER, {
			apiKey: 'k',
			apiKeyHeader: 'X-Api-Key',
			authToken: 'Bearer t',
			headers: { 'X-Route': 'a', 'X-Api-Key': 'caller-cannot-clobber' }
		});
		await stats.getVersion();
		const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
		expect(headers.get('X-Api-Key')).toBe('k');
		expect(headers.get('Authorization')).toBe('Bearer t');
		expect(headers.get('X-Route')).toBe('a');
		expect(headers.get('RhinoComputeKey')).toBeNull();
		await stats.dispose();
	});
});

describe('getServerStats aggregation', () => {
	it('returns only { isOnline: false } when offline (no extra round-trips)', async () => {
		route({ '/': () => res('', { ok: false, status: 503 }) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getServerStats()).resolves.toEqual({ isOnline: false });
		await stats.dispose();
	});

	it('aggregates version + activeChildren when online', async () => {
		route({
			'/version': () => res(JSON.stringify({ rhino: '8', compute: '1', git_sha: null })),
			// getServerStats reads the child count passively (no spawn).
			'/activechildren?initialize=false': () => res('2'),
			'/': () => res('compute.rhino3d running')
		});
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getServerStats()).resolves.toEqual({
			isOnline: true,
			version: { rhino: '8', compute: '1', git_sha: null },
			activeChildren: 2
		});
		await stats.dispose();
	});
});

describe('purgeCache', () => {
	it('returns the purged count from { purged: N }', async () => {
		route({ '/cache/purge': () => res(JSON.stringify({ purged: 17 })) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.purgeCache()).resolves.toBe(17);
		await stats.dispose();
	});

	it('POSTs to /cache/purge', async () => {
		route({ '/cache/purge': () => res(JSON.stringify({ purged: 0 })) });
		const stats = new ComputeServerStats(SERVER);
		await stats.purgeCache();
		expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/cache/purge`);
		expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
		await stats.dispose();
	});

	it('returns null on a non-JSON / unexpected body', async () => {
		route({ '/cache/purge': () => res('purged') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.purgeCache()).resolves.toBeNull();
		await stats.dispose();
	});
});

describe('purgeAllChildren', () => {
	it('reads the passive child count and fires 2× purges', async () => {
		let purges = 0;
		route({
			'/activechildren?initialize=false': () => res('3'),
			'/cache/purge': () => {
				purges++;
				return res(JSON.stringify({ purged: 5 }));
			}
		});
		const stats = new ComputeServerStats(SERVER);
		const result = await stats.purgeAllChildren();
		expect(result).toEqual({ totalPurged: 30, calls: 6, children: 3, confident: false });
		expect(purges).toBe(6); // 2 × 3
		// The count probe must be the non-spawning variant.
		expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/activechildren?initialize=false`);
		await stats.dispose();
	});

	it('is confident at a single-child pool (one purge is exact)', async () => {
		route({
			'/activechildren?initialize=false': () => res('1'),
			'/cache/purge': () => res(JSON.stringify({ purged: 7 }))
		});
		const stats = new ComputeServerStats(SERVER);
		const result = await stats.purgeAllChildren();
		expect(result).toEqual({ totalPurged: 14, calls: 2, children: 1, confident: true });
		await stats.dispose();
	});

	it('short-circuits with zero work when no children are live', async () => {
		let purges = 0;
		route({
			'/activechildren?initialize=false': () => res('0'),
			'/cache/purge': () => {
				purges++;
				return res(JSON.stringify({ purged: 1 }));
			}
		});
		const stats = new ComputeServerStats(SERVER);
		const result = await stats.purgeAllChildren();
		expect(result).toEqual({ totalPurged: 0, calls: 0, children: 0, confident: true });
		expect(purges).toBe(0);
		await stats.dispose();
	});

	it('returns null when the child count is unreadable', async () => {
		route({ '/activechildren?initialize=false': () => res('', { ok: false, status: 503 }) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.purgeAllChildren()).resolves.toBeNull();
		await stats.dispose();
	});

	it('tolerates a failed purge mid-loop (skips it, keeps going)', async () => {
		let n = 0;
		route({
			'/activechildren?initialize=false': () => res('2'),
			'/cache/purge': () => {
				n++;
				// Second of the four calls fails; the rest return 4 each.
				return n === 2 ? res('', { ok: false, status: 500 }) : res(JSON.stringify({ purged: 4 }));
			}
		});
		const stats = new ComputeServerStats(SERVER);
		const result = await stats.purgeAllChildren();
		// 4 calls, one failed -> 3 × 4 purged.
		expect(result).toEqual({ totalPurged: 12, calls: 4, children: 2, confident: false });
		await stats.dispose();
	});
});

describe('getServerTime', () => {
	it('parses the JSON-quoted ISO timestamp into a Date', async () => {
		route({ '/servertime': () => res('"2026-06-18T08:30:00Z"') });
		const stats = new ComputeServerStats(SERVER);
		const t = await stats.getServerTime();
		expect(t?.toISOString()).toBe('2026-06-18T08:30:00.000Z');
		await stats.dispose();
	});

	it('returns null on an unparseable body', async () => {
		route({ '/servertime': () => res('"not-a-date"') });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.getServerTime()).resolves.toBeNull();
		await stats.dispose();
	});
});

describe('child-lifecycle control', () => {
	it('launchChildren POSTs and returns { spawned, active }', async () => {
		route({ '/launch-children': () => res(JSON.stringify({ spawned: [6001, 6002], active: 2 })) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.launchChildren()).resolves.toEqual({ spawned: [6001, 6002], active: 2 });
		expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
		await stats.dispose();
	});

	it('launchChild appends ?port=N when a port is given', async () => {
		route({ '/launch-child?port=6003': () => res(JSON.stringify({ spawned: [6003] })) });
		const stats = new ComputeServerStats(SERVER);
		await expect(stats.launchChild(6003)).resolves.toEqual({ spawned: [6003] });
		expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/launch-child?port=6003`);
		await stats.dispose();
	});
});

describe('a failed read', () => {
	it.each<[string, (stats: ComputeServerStats) => Promise<unknown>]>([
		['getInstalledPlugins', (stats) => stats.getInstalledPlugins()],
		['getActiveChildren', (stats) => stats.getActiveChildren()],
		['getVersion', (stats) => stats.getVersion()],
		['getIdleSpan', (stats) => stats.getIdleSpan()],
		['purgeCache', (stats) => stats.purgeCache()],
		['recycleChildren', (stats) => stats.recycleChildren()]
	])('%s returns null on a non-2xx or a network failure, never throwing', async (_name, read) => {
		const stats = new ComputeServerStats(SERVER);

		fetchMock.mockResolvedValue(res('', { ok: false, status: 500 }));
		await expect(read(stats)).resolves.toBeNull();

		fetchMock.mockRejectedValue(new TypeError('fetch failed'));
		await expect(read(stats)).resolves.toBeNull();

		await stats.dispose();
	});
});

describe('disposal', () => {
	it('throws INVALID_STATE when used after dispose', async () => {
		const stats = new ComputeServerStats(SERVER);
		await stats.dispose();
		await expect(stats.isServerOnline()).rejects.toMatchObject({ code: 'INVALID_STATE' });
	});

	it('is idempotent', async () => {
		const stats = new ComputeServerStats(SERVER);
		await stats.dispose();
		await expect(stats.dispose()).resolves.toBeUndefined();
	});
});

describe('monitor', () => {
	afterEach(() => setLogger(null));

	// A sub-floor intervalMs would hot-loop the server.
	it('throws INVALID_CONFIG for zero, negative, sub-floor, NaN, and Infinity intervalMs', async () => {
		const stats = new ComputeServerStats(SERVER);
		const cb = () => {};
		for (const interval of [0, -5, 50, NaN, Infinity]) {
			let thrown: unknown;
			try {
				stats.monitor(cb, interval);
			} catch (err) {
				thrown = err;
			}
			expect(thrown, `monitor must reject intervalMs=${interval}`).toMatchObject({
				name: 'ComputeError',
				code: 'INVALID_CONFIG'
			});
		}
		await stats.dispose();
	});

	it('accepts an intervalMs at the floor and polls immediately', async () => {
		route({
			'/version': () => res(JSON.stringify({ rhino: '8', compute: '1', git_sha: null })),
			'/activechildren?initialize=false': () => res('1'),
			'/': () => res('compute.rhino3d running')
		});
		const stats = new ComputeServerStats(SERVER);
		const seen: unknown[] = [];
		const stop = stats.monitor((s) => seen.push(s), 100);
		await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
		stop();
		expect(seen[0]).toMatchObject({ isOnline: true });
		await stats.dispose();
	});

	// dispose() racing an in-flight poll is normal shutdown: the nested
	// INVALID_STATE throw must not surface as an error-level log.
	it('stays silent when dispose() races an in-flight poll', async () => {
		let resolveFetch!: (r: Response) => void;
		fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolveFetch = r)));

		const errorSpy = vi.fn();
		setLogger({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: errorSpy });

		const stats = new ComputeServerStats(SERVER);
		const callback = vi.fn();
		stats.monitor(callback, 1000);

		// The initial poll's fetch is now in flight; dispose before it resolves.
		await stats.dispose();
		resolveFetch(res('compute.rhino3d running'));

		// Let the poll's continuation (nested ensureNotDisposed throw) settle.
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(errorSpy).not.toHaveBeenCalled();
		expect(callback).not.toHaveBeenCalled();
	});

	it('drops the result of a poll still in flight when stopped', async () => {
		let answerProbe!: (r: Response) => void;
		fetchMock.mockImplementation(() => new Promise<Response>((r) => (answerProbe = r)));

		const stats = new ComputeServerStats(SERVER);
		const poll = vi.spyOn(stats, 'getServerStats');
		const callback = vi.fn();
		const stop = stats.monitor(callback, 1000);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

		stop();
		answerProbe(res('', { ok: false, status: 503 }));
		await expect(poll.mock.results[0].value).resolves.toEqual({ isOnline: false });

		expect(callback).not.toHaveBeenCalled();
		await stats.dispose();
	});
});

describe('ComputeServerStats — body size', () => {
	it('gives up on an oversized body instead of buffering it', async () => {
		fetchMock.mockResolvedValue(res('{"rhino":"' + 'x'.repeat(2 << 20) + '"}'));
		const stats = new ComputeServerStats(SERVER);

		expect(await stats.getVersion()).toBeNull();
	});
});

describe('ComputeServerStats — probe connection', () => {
	it('releases the probe response body', async () => {
		let cancelled = false;
		const body = new ReadableStream({
			cancel() {
				cancelled = true;
			}
		});
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		expect(await new ComputeServerStats(SERVER).isServerOnline()).toBe(true);
		expect(cancelled).toBe(true);
	});
});

describe('ComputeServerStats — probe failures as undici reports them', () => {
	const fetchFailed = (cause: unknown) => new TypeError('fetch failed', { cause });
	const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

	it.each([
		['refused', 'refused', withCode('connect ECONNREFUSED 127.0.0.1:6500', 'ECONNREFUSED')],
		['refused over happy eyeballs', 'refused', withCode('', 'ECONNREFUSED')],
		['unresolved', 'dns', withCode('getaddrinfo ENOTFOUND compute.example', 'ENOTFOUND')]
	])('classifies a %s host from the cause', async (_name, verdict, cause) => {
		fetchMock.mockRejectedValue(fetchFailed(cause));
		const stats = new ComputeServerStats(SERVER);
		expect(classifyProbeFailure(await stats.probeServer())?.verdict).toBe(verdict);
	});

	it('still reports an error with no cause', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		const stats = new ComputeServerStats(SERVER);
		expect((await stats.probeServer()).error).toBe('TypeError: Failed to fetch');
	});
});

describe('ComputeServerStats — headers', () => {
	it('sends no Content-Type on a GET, which would force a CORS preflight', async () => {
		fetchMock.mockResolvedValue(res('1.0'));
		await new ComputeServerStats(SERVER, { headers: { 'X-Tenant': 'a' } }).getVersion();
		const { headers } = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
		expect(headers).toEqual({ 'X-Tenant': 'a' });
	});

	it('sends one Content-Type on a POST when the caller set it in another case', async () => {
		fetchMock.mockResolvedValue(res('{"purged":1}'));
		const stats = new ComputeServerStats(SERVER, { headers: { 'content-type': 'text/plain' } });
		await stats.purgeCache();
		const { headers } = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
		expect(headers).toEqual({ 'Content-Type': 'application/json' });
	});

	it('rejects an unsendable API key at construction, without quoting it', () => {
		expect.assertions(2);
		try {
			new ComputeServerStats(SERVER, 'super-secret\nkey');
		} catch (error) {
			expect((error as ComputeError).code).toBe('INVALID_CONFIG');
			expect((error as ComputeError).message).not.toContain('super-secret');
		}
	});
});
