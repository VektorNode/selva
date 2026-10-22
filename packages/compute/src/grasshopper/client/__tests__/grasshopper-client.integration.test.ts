/**
 * GrasshopperClient through the stubbed global `fetch`, routed by URL so each leg (liveness `/`,
 * grasshopper, io) runs the real URL building without a live Compute server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GrasshopperClient from '@/grasshopper/client/grasshopper-client';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const SERVER = 'http://localhost:6500';

afterEach(() => {
	fetchMock.mockReset();
});

/** Route fetch by URL suffix; unmatched URLs reject so gaps are loud. */
function route(handlers: Record<string, () => Response>) {
	fetchMock.mockImplementation((url: string) => {
		for (const [suffix, make] of Object.entries(handlers)) {
			if (url.endsWith(suffix)) return Promise.resolve(make());
		}
		return Promise.reject(new Error(`unrouted fetch: ${url}`));
	});
}

const onlineServer = () => createMockResponse({ status: 'healthy' });

describe('GrasshopperClient.create', () => {
	it('resolves when the server liveness probe is OK', async () => {
		route({ '/': onlineServer });
		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		expect(client).toBeInstanceOf(GrasshopperClient);
		await client.dispose();
	});

	it('throws NETWORK_ERROR when the server is offline', async () => {
		route({
			'/': () => createMockResponse({}, { ok: false, status: 503, statusText: 'down' })
		});
		await expect(
			GrasshopperClient.create({ serverUrl: SERVER }, { probe: { attempts: 0 } })
		).rejects.toMatchObject({
			code: 'NETWORK_ERROR'
		});
	});

	it('stops retrying a refused connection instead of spending the whole ladder', async () => {
		// A powered-off Rhino.Compute refuses immediately. Retrying cannot help, and
		// the wait is paid by whoever clicked Solve.
		let probes = 0;
		fetchMock.mockImplementation(() => {
			probes += 1;
			return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6500'));
		});
		await expect(
			GrasshopperClient.create({ serverUrl: SERVER }, { probe: { attempts: 5 } })
		).rejects.toMatchObject({
			code: 'NETWORK_ERROR',
			context: { probeVerdict: 'refused', probeRetryable: false, attempts: 1 }
		});
		expect(probes).toBe(1);
	});

	it('stops retrying a rejected API key', async () => {
		let probes = 0;
		fetchMock.mockImplementation(() => {
			probes += 1;
			return Promise.resolve(createMockResponse({}, { ok: false, status: 401 }));
		});
		await expect(
			GrasshopperClient.create({ serverUrl: SERVER }, { probe: { attempts: 5 } })
		).rejects.toMatchObject({
			code: 'NETWORK_ERROR',
			context: { probeVerdict: 'unauthorized' }
		});
		expect(probes).toBe(1);
	});

	it('authenticates the liveness probe the way solves authenticate', async () => {
		// A gateway that only accepts the bearer token and a custom key header.
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			const headers = new Headers(init.headers);
			const authorized =
				headers.get('Authorization') === 'Bearer t' && headers.get('X-Api-Key') === 'k';
			return Promise.resolve(
				authorized ? onlineServer() : createMockResponse({}, { ok: false, status: 401 })
			);
		});

		const client = await GrasshopperClient.create({
			serverUrl: SERVER,
			authToken: 'Bearer t',
			apiKey: 'k',
			apiKeyHeader: 'X-Api-Key'
		});
		expect(client).toBeInstanceOf(GrasshopperClient);
		await client.dispose();
	});

	it('still exhausts the ladder for a retryable failure', async () => {
		let probes = 0;
		fetchMock.mockImplementation(() => {
			probes += 1;
			return Promise.resolve(createMockResponse({}, { ok: false, status: 503 }));
		});
		await expect(
			GrasshopperClient.create(
				{ serverUrl: SERVER },
				{ probe: { attempts: 2, baseDelayMs: 1, maxDelayMs: 2 } }
			)
		).rejects.toMatchObject({ code: 'NETWORK_ERROR', context: { probeVerdict: 'http_error' } });
		expect(probes).toBe(3);
	});

	it('retries a flaky liveness probe and succeeds once it goes 2xx', async () => {
		// Cold/busy-but-up server: first probe flickers 503, then recovers.
		let calls = 0;
		fetchMock.mockImplementation((url: string) => {
			if (url.endsWith('/')) {
				calls += 1;
				return Promise.resolve(
					calls === 1
						? createMockResponse({}, { ok: false, status: 503, statusText: 'warming up' })
						: onlineServer()
				);
			}
			return Promise.reject(new Error(`unrouted fetch: ${url}`));
		});

		const client = await GrasshopperClient.create(
			{ serverUrl: SERVER },
			{ probe: { baseDelayMs: 1 } }
		);
		expect(client).toBeInstanceOf(GrasshopperClient);
		expect(calls).toBe(2);
		await client.dispose();
	});

	it('keeps the probe ladder when config.retry turns solve retries off', async () => {
		let calls = 0;
		fetchMock.mockImplementation(() => {
			calls += 1;
			return Promise.resolve(
				calls === 1 ? createMockResponse({}, { ok: false, status: 503 }) : onlineServer()
			);
		});

		const client = await GrasshopperClient.create(
			{ serverUrl: SERVER, retry: { attempts: 0 } },
			{ probe: { baseDelayMs: 1 } }
		);
		expect(calls).toBe(2);
		await client.dispose();
	});
});

describe('GrasshopperClient.solve (e2e through transport)', () => {
	it('sends the data tree and returns the parsed compute response', async () => {
		const computeResponse = {
			values: [{ ParamName: 'out', InnerTree: {} }],
			errors: [],
			warnings: []
		};
		route({
			'/': onlineServer,
			'/grasshopper': () => createMockResponse(computeResponse)
		});

		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		const result = await client.solve('http://example.com/def.gh', [
			{ ParamName: 'radius', InnerTree: { '{0}': [{ type: 'System.Double', data: '5' }] } } as any
		]);

		expect(result).toEqual(computeResponse);

		// The grasshopper request carried our pointer + values.
		const ghCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/grasshopper'))!;
		const body = JSON.parse(ghCall[1].body);
		expect(body.pointer).toBe('http://example.com/def.gh');
		expect(body.values).toHaveLength(1);

		await client.dispose();
	});

	it('rejects an empty definition with INVALID_INPUT before any network call', async () => {
		route({ '/': onlineServer });
		const client = await GrasshopperClient.create({ serverUrl: SERVER });

		await expect(client.solve('   ', [])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
		// no /grasshopper call was made
		expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/grasshopper'))).toBe(false);

		await client.dispose();
	});

	it('surfaces a partial-success response (values + errors) as COMPUTATION_ERROR', async () => {
		const partial = {
			values: [{ ParamName: 'out' }],
			errors: ['Solve exception: bad'],
			warnings: []
		};
		route({
			'/': onlineServer,
			'/grasshopper': () =>
				createMockResponse(null, {
					ok: false,
					status: 500,
					statusText: 'Internal Server Error',
					body: JSON.stringify(partial)
				})
		});

		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		await expect(client.solve('http://example.com/def.gh', [])).rejects.toMatchObject({
			code: 'COMPUTATION_ERROR'
		});
		await client.dispose();
	});

	it('preserves partial-success values and summarizes inputs on the thrown error ', async () => {
		const partial = {
			values: [
				{
					ParamName: 'computed',
					InnerTree: { '{0}': [{ type: 'System.Int32', data: '42', id: '' }] }
				}
			],
			errors: ['Solve exception: one component failed'],
			warnings: ['minor warning']
		};
		route({
			'/': onlineServer,
			'/grasshopper': () =>
				createMockResponse(null, {
					ok: false,
					status: 500,
					statusText: 'Internal Server Error',
					body: JSON.stringify(partial)
				})
		});

		const dataTree = [
			{
				ParamName: 'radius',
				InnerTree: {
					'{0}': [
						{ type: 'System.Double', data: '5' },
						{ type: 'System.Double', data: '2.5' }
					]
				}
			}
		] as any;

		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		const error: any = await client.solve('http://example.com/def.gh', dataTree).catch((e) => e);
		await client.dispose();

		expect(error.code).toBe('COMPUTATION_ERROR');

		// The outputs that did compute travel on the error, so callers can render them.
		expect(error.context.values).toEqual(partial.values);
		expect(error.context.errors).toEqual(partial.errors);
		expect(error.context.warnings).toEqual(partial.warnings);

		// Only a summary of the inputs: the full tree would pin multi-MB buffers.
		expect(error.context.inputs).toBeUndefined();
		expect(error.context.inputSummary).toEqual([
			{ param: 'radius', items: 2, bytes: '5'.length + '2.5'.length }
		]);
	});
});

describe('GrasshopperClient.createScheduler', () => {
	it('reports the first solve of a definition as a re-upload, then a pointer hit', async () => {
		route({
			'/': onlineServer,
			'/grasshopper': () => createMockResponse({ values: [], pointer: 'md5_ABC' })
		});
		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		const settled: Array<boolean | undefined> = [];
		const scheduler = client.createScheduler({
			mode: 'queue',
			onSettle: (_ctx, result) => {
				if (result.status === 'success') settled.push(result.definitionReuploaded);
			}
		});
		const definition = new TextEncoder().encode('definition-content');

		await scheduler.solve(definition, []);
		await scheduler.solve(definition, []);

		expect(settled).toEqual([true, false]);
		scheduler.dispose();
		await client.dispose();
	});

	it("hands solveDetailed's per-call onServerTiming the response's Server-Timing", async () => {
		route({
			'/': onlineServer,
			'/grasshopper': () =>
				createMockResponse(
					{ values: [], pointer: 'md5_ABC' },
					{ headers: { 'Server-Timing': 'decode;dur=4, solve;dur=20, encode;dur=2' } }
				)
		});
		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		const scheduler = client.createScheduler({ mode: 'queue' });
		const onServerTiming = vi.fn();

		const detail = await scheduler.solveDetailed(new TextEncoder().encode('definition'), [], {
			onServerTiming
		});

		expect(detail).toMatchObject({ fromCache: false, definitionReuploaded: true });
		expect(onServerTiming).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ decode: 4, solve: 20, encode: 2 }),
			expect.any(String)
		);
		scheduler.dispose();
		await client.dispose();
	});
});

describe('GrasshopperClient.getIO (e2e through transport + parser pipeline)', () => {
	it('fetches IO and parses raw inputs into typed InputParams', async () => {
		// camelCase to match the real Compute8 server contract (pinned by
		// tests/contract/server-contract.test.ts) — fetchDefinitionIO reads these
		// straight through with no key conversion.
		const ioResponse = {
			inputnames: [],
			outputnames: [],
			inputs: [
				{
					name: 'Radius',
					nickname: 'R',
					description: '',
					paramType: 'Number',
					treeAccess: false,
					groupName: null,
					minimum: 0,
					maximum: 10,
					atLeast: 1,
					atMost: 1,
					default: '5'
				}
			],
			outputs: []
		};
		route({
			'/': onlineServer,
			'/io': () => createMockResponse(ioResponse)
		});

		const client = await GrasshopperClient.create({ serverUrl: SERVER });
		const io = await client.getIO('http://example.com/def.gh');

		expect(io.inputs).toHaveLength(1);
		const input = io.inputs[0] as any;
		expect(input.paramType).toBe('Number');
		expect(input.name).toBe('Radius');
		// '5' coerced to a number by the numeric parser, through the full pipeline.
		expect(input.default).toBe(5);

		await client.dispose();
	});
});
