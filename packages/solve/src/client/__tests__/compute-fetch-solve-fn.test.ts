/**
 * Tests for `createComputeFetchSolveFn` — the fetch-based `SolveFn` factory.
 * `fetch` is stubbed per test; `@selvajs/compute`'s `GrasshopperResponseProcessor`
 * is real (pure data-shape logic, no network) so output extraction is exercised
 * end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createComputeFetchSolveFn } from '../compute-fetch-solve-fn.js';

function jsonResponse(body: unknown, init?: ResponseInit & { url?: string; redirected?: boolean }) {
	const res = new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		headers: init?.headers ?? { 'Content-Type': 'application/json' }
	});
	if (init?.url !== undefined) Object.defineProperty(res, 'url', { value: init.url });
	if (init?.redirected !== undefined)
		Object.defineProperty(res, 'redirected', { value: init.redirected });
	return res;
}

function baseOpts(over: Partial<Parameters<typeof createComputeFetchSolveFn>[0]> = {}) {
	return {
		endpoint: '/api/compute',
		definitionUrl: () => 'local:abc',
		inputs: () => [{ id: 'a' }],
		outputs: () => [{ id: 'out-1', nickname: 'Out' }],
		...over
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createComputeFetchSolveFn — happy path', () => {
	it('builds the request body and extracts outputs by id', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				values: [{ ParamName: 'Out', InnerTree: { '{0}': [{ data: '5' }] } }],
				errors: [],
				warnings: []
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({ a: 1 }, new AbortController().signal);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/compute');
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			inputs: [{ id: 'a' }],
			values: { a: 1 },
			definitionUrl: 'local:abc'
		});

		// Compute names no ids, so this one resolves through its nickname.
		expect(result.outputs).toEqual({ 'out-1': '5' });
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.meshes).toEqual([]);
	});

	it('sends a bearer token in the Authorization header, never the URL', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [] }));
		const solve = createComputeFetchSolveFn(baseOpts({ bearerToken: () => 'share_abc' }));
		await solve({}, new AbortController().signal);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/compute');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer share_abc');
	});

	it('sends no Authorization header without a bearer token', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [] }));
		const solve = createComputeFetchSolveFn(baseOpts({ bearerToken: () => null }));
		await solve({}, new AbortController().signal);

		expect(new Headers(fetchMock.mock.calls[0][1].headers).has('authorization')).toBe(false);
	});

	it('leaves an output neither its id nor its nickname finds undefined', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ values: [{ ParamName: 'Other', InnerTree: { '{0}': [{ data: '5' }] } }] })
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, new AbortController().signal);
		expect(result.outputs['out-1']).toBeUndefined();
	});

	it('includes versionId over channel when both are present', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const solve = createComputeFetchSolveFn(
			baseOpts({ channel: () => 'draft', versionId: () => 'v-1' })
		);
		await solve({}, new AbortController().signal);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.versionId).toBe('v-1');
		expect(body.channel).toBeUndefined();
	});

	it('calls meshes.extract once per solve when meshes is configured', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const extract = vi.fn((_response: unknown, _opts: { debug: boolean; signal: AbortSignal }) => [
			{ mesh: 1 }
		]);
		const solve = createComputeFetchSolveFn(baseOpts({ meshes: { extract } }));
		const { signal } = new AbortController();
		const result = await solve({}, signal);
		expect(extract).toHaveBeenCalledTimes(1);
		expect(extract.mock.calls[0][1]).toEqual({ debug: false, signal });
		expect(result.meshes).toEqual([{ mesh: 1 }]);
	});
});

describe('createComputeFetchSolveFn — session expiry', () => {
	it('401 response calls onSessionExpired', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 401 }));
		const onSessionExpired = vi.fn(() => {
			throw new Error('custom session expired');
		});
		const solve = createComputeFetchSolveFn(baseOpts({ onSessionExpired }));
		await expect(solve({}, new AbortController().signal)).rejects.toThrow('custom session expired');
		expect(onSessionExpired).toHaveBeenCalledTimes(1);
	});

	it('still throws when the handler returns, instead of reading the login page as a result', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({}, { status: 200, url: 'https://app.example/login', redirected: true })
		);
		const onSessionExpired = vi.fn();
		const solve = createComputeFetchSolveFn(baseOpts({ onSessionExpired }));
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/session has expired/);
		expect(onSessionExpired).toHaveBeenCalledTimes(1);
	});

	it('honours a host whose sign-in page is not /login', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({}, { status: 200, url: 'https://app.example/auth/sign-in', redirected: true })
		);
		const solve = createComputeFetchSolveFn(baseOpts({ loginPath: '/auth/sign-in' }));
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/session has expired/);
	});

	it('default onSessionExpired throws an actionable message', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 401 }));
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/session has expired/);
	});

	it('a redirect to /login is treated as session expiry', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({}, { status: 200, url: 'https://app.example/login', redirected: true })
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/session has expired/);
	});
});

describe('createComputeFetchSolveFn — rate limiting', () => {
	it('429 calls onRateLimited and starts a cooldown that short-circuits the next solve', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ message: 'slow down', retryAfter: 60 }), {
				status: 429,
				headers: { 'Content-Type': 'application/json', 'Retry-After': '60' }
			})
		);
		const onRateLimited = vi.fn();
		const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/Rate limit reached/);
		expect(onRateLimited).toHaveBeenCalledWith(60);

		fetchMock.mockClear();
		onRateLimited.mockClear();
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/Rate limit reached/);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(onRateLimited).toHaveBeenCalledTimes(1);
	});

	it('default onRateLimited throws a cooldown-aware Error', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ retryAfter: 5 }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/Rate limit reached/);
	});

	describe('cooldown', () => {
		beforeEach(() => {
			vi.useFakeTimers({ now: Date.parse('2026-11-02T12:00:00Z') });
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		const respond = (status: number, retryAfter?: string, body = '{"message":"busy"}') =>
			fetchMock.mockImplementation(
				async () =>
					new Response(body, {
						status,
						headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter }
					})
			);

		/** How many POSTs five solves make, a second apart. */
		async function postsOverFiveSeconds(solve: ReturnType<typeof createComputeFetchSolveFn>) {
			for (let i = 0; i < 5; i++) {
				await solve({}, new AbortController().signal).catch(() => {});
				await vi.advanceTimersByTimeAsync(1_000);
			}
			return fetchMock.mock.calls.length;
		}

		it('a 503 with Retry-After backs off like a 429', async () => {
			respond(503, '30');
			const solve = createComputeFetchSolveFn(baseOpts());
			await expect(solve({}, new AbortController().signal)).rejects.toThrow('busy');
			expect(await postsOverFiveSeconds(solve)).toBe(1);
		});

		it('a 503 without one does not', async () => {
			respond(503);
			expect(await postsOverFiveSeconds(createComputeFetchSolveFn(baseOpts()))).toBe(5);
		});

		it('a 429 without one waits the default 5 s', async () => {
			respond(429);
			const onRateLimited = vi.fn();
			const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
			await solve({}, new AbortController().signal).catch(() => {});
			expect(onRateLimited).toHaveBeenCalledWith(5);
		});

		it('reads an HTTP-date', async () => {
			respond(429, 'Mon, 02 Nov 2026 12:00:30 GMT');
			const onRateLimited = vi.fn();
			const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
			await solve({}, new AbortController().signal).catch(() => {});
			expect(onRateLimited).toHaveBeenCalledWith(30);
		});

		it('reads a date already past as no wait', async () => {
			respond(429, 'Mon, 02 Nov 2026 11:00:00 GMT');
			const onRateLimited = vi.fn();
			const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
			await solve({}, new AbortController().signal).catch(() => {});
			expect(onRateLimited).toHaveBeenCalledWith(0);
		});

		it('takes 0 at its word', async () => {
			respond(429, '0');
			expect(await postsOverFiveSeconds(createComputeFetchSolveFn(baseOpts()))).toBe(5);
		});

		it.each(['-30', 'Infinity', 'soon'])('falls back on an unusable %s', async (header) => {
			respond(429, header);
			const onRateLimited = vi.fn();
			const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
			await solve({}, new AbortController().signal).catch(() => {});
			expect(onRateLimited).toHaveBeenCalledWith(5);
		});

		it('falls back to the body hint when the header is unusable', async () => {
			respond(429, 'soon', '{"retryAfter":12}');
			const onRateLimited = vi.fn();
			const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
			await solve({}, new AbortController().signal).catch(() => {});
			expect(onRateLimited).toHaveBeenCalledWith(12);
		});

		it('caps a huge wait, so a bad header cannot lock the solve function for good', async () => {
			respond(429, '999999999');
			const onRateLimited = vi.fn();
			const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
			await solve({}, new AbortController().signal).catch(() => {});
			expect(onRateLimited).toHaveBeenCalledWith(3600);
		});
	});
});

describe('createComputeFetchSolveFn — malformed responses', () => {
	const solveOnce = () => createComputeFetchSolveFn(baseOpts())({}, new AbortController().signal);

	it('non-JSON 200 body throws an actionable reload error', async () => {
		fetchMock.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
		await expect(solveOnce()).rejects.toThrow(/invalid response/);
	});

	it.each(['null', '[]', '5', '"text"'])('a 200 of %s is not a result', async (body) => {
		fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
		await expect(solveOnce()).rejects.toThrow(/invalid response/);
	});

	it('503 throws a compute-offline message', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 503 }));
		await expect(solveOnce()).rejects.toThrow(/offline or unreachable/);
	});

	it("503 shows the server's own message when it names the failure", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ message: 'bad API key' }, { status: 503 }));
		await expect(solveOnce()).rejects.toThrow('bad API key');
	});

	it('500 shows the server message, or the status without one', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'solver died' }, { status: 500 }));
		await expect(solveOnce()).rejects.toThrow('solver died');
		fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
		await expect(solveOnce()).rejects.toThrow('Compute error (HTTP 500)');
	});

	it.each(['null', '[]', '{"message":{}}', '{"message":7}'])(
		'an error body of %s falls back to the status',
		async (body) => {
			fetchMock.mockResolvedValue(new Response(body, { status: 500 }));
			await expect(solveOnce()).rejects.toThrow('Compute error (HTTP 500)');
		}
	);

	it('a body cut off mid-download reads as a dropped connection, with the cause', async () => {
		const res = new Response('{}', { status: 200 });
		const cut = new TypeError('terminated');
		res.text = () => Promise.reject(cut);
		fetchMock.mockResolvedValue(res);
		await expect(solveOnce()).rejects.toMatchObject({
			message: expect.stringContaining('connection dropped'),
			cause: cut
		});
	});
});

describe('createComputeFetchSolveFn — network failure', () => {
	it('says it could not reach the server, without claiming the session ended', async () => {
		const refused = new TypeError('fetch failed');
		fetchMock.mockRejectedValue(refused);
		const solve = createComputeFetchSolveFn(baseOpts());
		const failure = await solve({}, new AbortController().signal).catch((e) => e);
		expect(failure.message).toMatch(/^Could not reach the server/);
		expect(failure.cause).toBe(refused);
	});
});

describe('createComputeFetchSolveFn — the structured verdict', () => {
	const outcome = {
		diagnostics: [{ level: 'warning', message: 'Too thin', source: 'Message', isGate: true }],
		blocked: false,
		aborted: false
	};

	it("prefers the fork's selva block over Compute's flattened strings", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ values: [], errors: ['noise'], warnings: [], selva: { outcome } })
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, new AbortController().signal);
		expect(result.diagnostics).toEqual(outcome.diagnostics);
		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual(['Too thin']);
	});

	it('drops outputs and source when the block says aborted', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				values: [{ ParamName: 'Out', InnerTree: { '{0}': [{ data: '5' }] } }],
				selva: { outcome: { ...outcome, aborted: true } }
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, new AbortController().signal);
		expect(result).toMatchObject({ outputs: {}, blocked: true, aborted: true });
		expect(result.source).toBeUndefined();
	});
});

describe('createComputeFetchSolveFn — abort handling', () => {
	it('abort before fetch resolves returns an empty result', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation(() => {
			controller.abort();
			return Promise.reject(new DOMException('aborted', 'AbortError'));
		});
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, controller.signal);
		expect(result).toEqual({ outputs: {} });
	});

	it('abort after headers but before body read returns an empty result', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation(async () => {
			const res = jsonResponse({ values: [], errors: [], warnings: [] });
			controller.abort();
			return res;
		});
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, controller.signal);
		expect(result).toEqual({ outputs: {} });
	});

	it('abort during the download returns an empty result', async () => {
		const controller = new AbortController();
		const res = new Response('{}', { status: 200 });
		res.text = () => {
			controller.abort();
			return Promise.reject(new DOMException('aborted', 'AbortError'));
		};
		fetchMock.mockResolvedValue(res);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, controller.signal);
		expect(result).toEqual({ outputs: {} });
	});
});

describe('createComputeFetchSolveFn — debug telemetry', () => {
	it('keeps an unreadable error body out of the console, even with debug on', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		fetchMock.mockResolvedValue(new Response('<html>SECRET</html>', { status: 500 }));

		const quiet = createComputeFetchSolveFn(baseOpts());
		await quiet({}, new AbortController().signal).catch(() => {});
		expect(warn).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();

		fetchMock.mockResolvedValue(new Response('<html>SECRET</html>', { status: 500 }));
		const verbose = createComputeFetchSolveFn(baseOpts({ debug: true }));
		await verbose({}, new AbortController().signal).catch(() => {});
		expect(JSON.stringify(info.mock.calls)).not.toContain('SECRET');
		vi.restoreAllMocks();
	});

	it('debug false (default): no console.info calls', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const solve = createComputeFetchSolveFn(baseOpts());
		await solve({}, new AbortController().signal);
		expect(logSpy).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it('debug true: emits console.info telemetry', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const solve = createComputeFetchSolveFn(baseOpts({ debug: true }));
		await solve({}, new AbortController().signal);
		expect(logSpy).toHaveBeenCalled();
		logSpy.mockRestore();
	});
});

describe('createComputeFetchSolveFn — blocked solves', () => {
	it('flags blocked and strips the marker from the message shown', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				values: [],
				errors: ['1. Solution exception:[Selva:blocked] Wall too thin'],
				warnings: []
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, new AbortController().signal);

		expect(result.blocked).toBe(true);
		// Both the marker and Compute's numbered-exception wrapper are wire plumbing, not
		// something the author wrote, so the user sees only their own sentence.
		expect(result.errors).toEqual(['Wall too thin']);
		expect(result.diagnostics).toEqual([
			{ level: 'error', message: 'Wall too thin', isGate: true }
		]);
	});

	it('drops the outputs and skips mesh extraction on a blocked solve', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				values: [
					{ ParamName: 'out', InnerTree: { '{0}': [{ type: 'System.Double', data: '1' }] } }
				],
				errors: ['[Selva:blocked] refused'],
				warnings: []
			})
		);
		const extract = vi.fn(async () => [{ id: 'mesh' }]);
		const solve = createComputeFetchSolveFn(
			baseOpts({
				outputs: () => [{ id: 'out', nickname: 'out' }],
				meshes: { extract }
			} as never)
		);
		const result = await solve({}, new AbortController().signal);

		expect(result.outputs).toEqual({});
		expect(result.meshes).toEqual([]);
		expect(extract).not.toHaveBeenCalled();
	});

	it('leaves an ordinary solve error unblocked and untouched', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				values: [],
				errors: ['1. Solution exception: division by zero'],
				warnings: []
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, new AbortController().signal);

		expect(result.blocked).toBe(false);
		expect(result.errors).toEqual(['1. Solution exception: division by zero']);
	});
});

describe('createComputeFetchSolveFn — keep-alive', () => {
	/** The wire a keep-alive server sends: spaces, a meta line, then the real body. */
	function keepaliveResponse(status: number, body: unknown, headers: [string, string][] = []) {
		const meta = JSON.stringify({
			status,
			headers: [['content-type', 'application/json'], ...headers]
		});
		return new Response(`   ${meta}\n${JSON.stringify(body)}`, {
			headers: { 'Preference-Applied': 'selva-keepalive' }
		});
	}

	it('asks for keep-alive only when the option is on', async () => {
		fetchMock.mockImplementation(async () => jsonResponse({ values: [] }));
		await createComputeFetchSolveFn(baseOpts())({}, new AbortController().signal);
		await createComputeFetchSolveFn(baseOpts({ keepalive: true }))(
			{},
			new AbortController().signal
		);

		const prefer = fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get('prefer'));
		expect(prefer).toEqual([null, 'selva-keepalive']);
	});

	it('reads the result from inside the keep-alive stream', async () => {
		fetchMock.mockResolvedValue(
			keepaliveResponse(200, {
				values: [{ ParamName: 'Out', InnerTree: { '{0}': [{ data: '5' }] } }]
			})
		);

		const result = await createComputeFetchSolveFn(baseOpts({ keepalive: true }))(
			{},
			new AbortController().signal
		);

		expect(result.outputs).toEqual({ 'out-1': '5' });
	});

	it('keeps the real status of a failure sent inside the 200', async () => {
		fetchMock.mockResolvedValue(
			keepaliveResponse(503, { message: 'Compute server is unreachable' })
		);

		await expect(
			createComputeFetchSolveFn(baseOpts({ keepalive: true }))({}, new AbortController().signal)
		).rejects.toThrow('Compute server is unreachable');
	});
});
