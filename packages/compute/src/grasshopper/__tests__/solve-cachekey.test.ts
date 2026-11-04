import { afterEach, describe, expect, it, vi } from 'vitest';

import { solveWithServerCacheKey, solveGrasshopperDefinition } from '../solve';
import { SolveScheduler } from '../scheduler/solve-scheduler';
import type { SolveExecutor } from '../scheduler/types';
import type { DefinitionRef } from '@/core/definition-ref';
import { ErrorCodes } from '@/core/errors';
import { getResponseWireSize } from '@/core/compute-fetch/wire-size';
import { readField } from '@/core/utils/read-field';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const config = { serverUrl: 'http://localhost:6500' };
const DEF = 'definition-content'; // plain string → uploaded as base64 algo

afterEach(() => fetchMock.mockReset());

/** Parse the request body of the Nth fetch call. */
function body(call = 0) {
	return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);
}

const okSolve = (over: Record<string, unknown> = {}) =>
	createMockResponse({ values: [], pointer: 'md5_ABC', ...over });

const loadFailed = () =>
	createMockResponse(
		{
			error: 'Internal Server Error',
			message: 'Invalid argument: Unable to load grasshopper definition'
		},
		{ ok: false, status: 500, statusText: 'Internal Server Error' }
	);

// Production servers scrub the message; only the machine `code` identifies the miss.
const loadFailedScrubbed = () =>
	createMockResponse(
		{
			error: 'Internal Server Error',
			message: 'An unexpected error occurred. Check server logs for details.',
			code: 'definition_not_cached'
		},
		{ ok: false, status: 500, statusText: 'Internal Server Error' }
	);

describe('solveWithServerCacheKey — no known key', () => {
	it('uploads, reports missed, and captures the key from the response pointer', async () => {
		fetchMock.mockResolvedValueOnce(okSolve({ pointer: 'md5_DEADBEEF' }));

		const { response, cacheKey, missed } = await solveWithServerCacheKey([], null, DEF, config);

		expect(missed).toBe(true);
		expect(cacheKey).toBe('md5_DEADBEEF');
		// The captured pointer is stripped from the returned response.
		expect(response).not.toHaveProperty('pointer');
		// First solve uploads the full base64 algo.
		expect(body().algo).toBeTruthy();
		expect(body().pointer).toBeNull();
	});

	it('reports null cacheKey when the server returns no pointer', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ values: [] }));
		const { cacheKey } = await solveWithServerCacheKey([], null, DEF, config);
		expect(cacheKey).toBeNull();
	});

	// The server echoes the request back, so `null` can't be used to detect a URL solve.
	it('returns the URL itself as cacheKey for a URL-pointer solve', async () => {
		const url = 'https://example.com/definition.gh';
		fetchMock.mockResolvedValueOnce(okSolve({ pointer: url }));

		const { cacheKey } = await solveWithServerCacheKey([], null, url, config);

		expect(cacheKey).toBe(url);
		// Sent as a pointer reference, not uploaded.
		expect(body().pointer).toBe(url);
		expect(body().algo).toBeNull();
	});

	it('strips the echoed algo from the response', async () => {
		fetchMock.mockResolvedValueOnce(okSolve({ algo: 'aHVnZS1iYXNlNjQtZGVmaW5pdGlvbg==' }));

		const { response } = await solveWithServerCacheKey([], null, DEF, config);

		expect(response).not.toHaveProperty('algo');
		expect(response).toHaveProperty('values');
	});

	it('re-registers the wire size on the stripped response, minus the echoed algo', async () => {
		const echoedAlgo = 'aHVnZS1iYXNlNjQtZGVmaW5pdGlvbg==';
		const wireBody = JSON.stringify({ values: [], pointer: 'md5_ABC', algo: echoedAlgo });
		fetchMock.mockResolvedValueOnce(createMockResponse(null, { body: wireBody }));

		const { response } = await solveWithServerCacheKey([], null, DEF, config);

		expect(getResponseWireSize(response)).toBe(wireBody.length - echoedAlgo.length);
	});
});

describe('solveWithServerCacheKey — known key', () => {
	it('solves by pointer and does NOT upload the base64', async () => {
		fetchMock.mockResolvedValueOnce(okSolve({ pointer: 'md5_ABC' }));

		const { missed, cacheKey } = await solveWithServerCacheKey([], 'md5_ABC', DEF, config);

		expect(missed).toBe(false);
		expect(cacheKey).toBe('md5_ABC');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(body().pointer).toBe('md5_ABC');
		expect(body().algo).toBeNull();
	});
});

describe('solveWithServerCacheKey — fallback on cache miss', () => {
	it('retries with the full upload when the key was evicted', async () => {
		fetchMock
			.mockResolvedValueOnce(loadFailed()) // pointer solve misses
			.mockResolvedValueOnce(okSolve({ pointer: 'md5_NEW' })); // full upload succeeds

		const { response, cacheKey, missed } = await solveWithServerCacheKey(
			[],
			'md5_OLD',
			DEF,
			config
		);

		expect(missed).toBe(true);
		expect(cacheKey).toBe('md5_NEW');
		expect(response.values).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// 1st: pointer attempt. 2nd: full algo upload.
		expect(body(0).pointer).toBe('md5_OLD');
		expect(body(0).algo).toBeNull();
		expect(body(1).algo).toBeTruthy();
		expect(body(1).pointer).toBeNull();
	});

	it('falls back when the miss is signalled by code, not message (prod server)', async () => {
		fetchMock
			.mockResolvedValueOnce(loadFailedScrubbed()) // pointer solve misses, message scrubbed
			.mockResolvedValueOnce(okSolve({ pointer: 'md5_NEW' })); // full upload succeeds

		const { cacheKey, missed } = await solveWithServerCacheKey([], 'md5_OLD', DEF, config);

		expect(missed).toBe(true);
		expect(cacheKey).toBe('md5_NEW');
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(body(1).algo).toBeTruthy();
	});

	it('does NOT fall back on an unrelated error', async () => {
		fetchMock.mockResolvedValueOnce(
			createMockResponse(
				{ error: 'Internal Server Error', message: 'Invalid argument: bad input' },
				{ ok: false, status: 500, statusText: 'Internal Server Error' }
			)
		);

		await expect(solveWithServerCacheKey([], 'md5_X', DEF, config)).rejects.toThrow(/bad input/);
		// Only the pointer attempt — no full-upload retry for a non-miss error.
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('DefinitionRef — bytes are materialized only when an upload is unavoidable', () => {
	// [104, 105] = "hi" → base64 "aGk="
	const refOf = (key = 'version-uuid-1'): DefinitionRef & { load: ReturnType<typeof vi.fn> } => ({
		key,
		load: vi.fn(async () => new Uint8Array([104, 105]))
	});

	it('pointer hit never calls load()', async () => {
		fetchMock.mockResolvedValueOnce(okSolve({ pointer: 'md5_ABC' }));
		const ref = refOf();

		const { missed } = await solveWithServerCacheKey([], 'md5_ABC', ref, config);

		expect(missed).toBe(false);
		expect(ref.load).not.toHaveBeenCalled();
		expect(body().pointer).toBe('md5_ABC');
		expect(body().algo).toBeNull();
	});

	it('pointer miss calls load() exactly once and uploads the loaded bytes', async () => {
		fetchMock
			.mockResolvedValueOnce(loadFailed())
			.mockResolvedValueOnce(okSolve({ pointer: 'md5_NEW' }));
		const ref = refOf();

		const { missed, cacheKey } = await solveWithServerCacheKey([], 'md5_OLD', ref, config);

		expect(missed).toBe(true);
		expect(cacheKey).toBe('md5_NEW');
		expect(ref.load).toHaveBeenCalledTimes(1);
		expect(body(1).algo).toBe('aGk=');
	});

	it('first solve (no known pointer) materializes once for the upload', async () => {
		fetchMock.mockResolvedValueOnce(okSolve());
		const ref = refOf();

		await solveWithServerCacheKey([], null, ref, config);

		expect(ref.load).toHaveBeenCalledTimes(1);
		expect(body().algo).toBe('aGk=');
	});

	it('wraps a load() failure in a ComputeError naming the ref, without fetching', async () => {
		const ref: DefinitionRef = {
			key: 'version-uuid-broken',
			load: async () => {
				throw new Error('storage down');
			}
		};

		await expect(solveGrasshopperDefinition([], ref, config)).rejects.toMatchObject({
			code: ErrorCodes.INVALID_INPUT,
			message: expect.stringContaining('version-uuid-broken')
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('a DefinitionRef whose load() hangs', () => {
	const hungRef = () => ({
		key: 'version-hung',
		load: vi.fn((_signal?: AbortSignal) => new Promise<Uint8Array>(() => {}))
	});

	it('passes the solve signal to load()', async () => {
		const ref = hungRef();
		const controller = new AbortController();
		const solving = solveGrasshopperDefinition([], ref, {
			serverUrl: 'http://localhost:6500',
			signal: controller.signal
		});
		controller.abort();
		await solving.catch(() => {});
		expect(ref.load.mock.calls[0][0]).toBe(controller.signal);
	});

	it('rejects ABORTED when the signal fires', async () => {
		const controller = new AbortController();
		const solving = solveGrasshopperDefinition([], hungRef(), {
			serverUrl: 'http://localhost:6500',
			signal: controller.signal
		});
		controller.abort(new Error('stale'));
		await expect(solving).rejects.toMatchObject({ code: 'ABORTED' });
	});

	it('rejects TIMEOUT_ERROR once timeoutMs passes, with no signal at all', async () => {
		await expect(
			solveGrasshopperDefinition([], hungRef(), { ...config, timeoutMs: 5 })
		).rejects.toMatchObject({ code: ErrorCodes.TIMEOUT_ERROR });
	});

	it('rejects an unusable timeoutMs as INVALID_CONFIG before loading', async () => {
		const ref = hungRef();
		await expect(
			solveGrasshopperDefinition([], ref, { ...config, timeoutMs: NaN })
		).rejects.toMatchObject({ code: ErrorCodes.INVALID_CONFIG });
		expect(ref.load).not.toHaveBeenCalled();
	});

	it('frees a queue slot at timeoutMs, so the next solve runs without a cancel', async () => {
		const executor: SolveExecutor = (definition, tree, cacheKey, solveConfig) =>
			solveWithServerCacheKey(tree, cacheKey, definition, solveConfig);
		fetchMock.mockImplementation(async () => createMockResponse({ values: [] }));
		const scheduler = new SolveScheduler(executor, config, { mode: 'queue', timeoutMs: 5 });

		const hung = scheduler.solve(hungRef(), []);
		const next = scheduler.solve('https://example.com/a.gh', []);

		await expect(hung).rejects.toMatchObject({ code: ErrorCodes.TIMEOUT_ERROR });
		await expect(next).resolves.toBeDefined();
	});

	it.each(['latest-wins', 'queue'] as const)(
		'frees the %s slot after cancelAll, so the next solve runs',
		async (mode) => {
			const executor: SolveExecutor = (definition, tree, cacheKey, config) =>
				solveWithServerCacheKey(tree, cacheKey, definition, config);
			fetchMock.mockImplementation(async () => createMockResponse({ values: [] }));
			const scheduler = new SolveScheduler(
				executor,
				{ serverUrl: 'http://localhost:6500' },
				{ mode }
			);

			const hung = scheduler.solve(hungRef(), []);
			hung.catch(() => {});
			await vi.waitFor(() => expect(scheduler.inFlightCount).toBe(1));
			scheduler.cancelAll();
			await vi.waitFor(() => expect(scheduler.inFlightCount).toBe(0));

			await expect(scheduler.solve('https://example.com/a.gh', [])).resolves.toBeDefined();
		}
	);
});

describe('a response with no values', () => {
	it('resolves with an empty array, as the type promises', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ warnings: ['slow'] }));
		const response = await solveGrasshopperDefinition([], 'https://example.com/a.gh', config);
		expect(response.values).toEqual([]);
		expect(response.warnings).toEqual(['slow']);
	});

	it('leaves a PascalCase Values key readable', async () => {
		const tree = { ParamName: 'Out', InnerTree: {} };
		fetchMock.mockResolvedValueOnce(createMockResponse({ Values: [tree] }));
		const response = await solveGrasshopperDefinition([], 'https://example.com/a.gh', config);
		expect(readField(response, 'values')).toEqual([tree]);
	});
});

describe('a null response body', () => {
	it('rejects INVALID_RESPONSE rather than crashing on destructure', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse(null));
		await expect(
			solveGrasshopperDefinition([], 'https://example.com/a.gh', {
				serverUrl: 'http://localhost:6500'
			})
		).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
	});
});
