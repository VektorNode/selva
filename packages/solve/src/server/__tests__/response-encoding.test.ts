import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import type { GrasshopperComputeResponse } from '@selvajs/compute/grasshopper';
import {
	acceptsGzip,
	buildEnvelope,
	COMPUTE_CONTRACT_VERSION,
	COMPUTE_VERSION_HEADER,
	createResponseEncoder,
	responseVariant,
	type EncodedBody
} from '../response-encoding.js';
import { BINARY_SOLVE_MEDIA_TYPE } from '../../shared/binary-response.js';
import { decodeBinarySolveResponse } from '../../client/binary-response.js';

const MB = 1024 * 1024;
const big = () => ({ values: 'x'.repeat(5000) });
const encoder = (response: object, maxBytes = 10 * MB) => createResponseEncoder(response, maxBytes);

function encoded(result: EncodedBody | 'too_large'): EncodedBody {
	if (result === 'too_large') throw new Error('expected a body');
	return result;
}

const metrics = {
	defLoadMs: 0,
	treeBuildMs: 0,
	solveMs: 0,
	serializeMs: 0,
	gzipMs: 0,
	serverTotalMs: 0,
	serializedBytes: 0,
	compressedBytes: null,
	rhino: null,
	settle: { fromCache: false }
};

describe('acceptsGzip', () => {
	it.each([
		['gzip', true],
		['gzip, br', true],
		['br, GZIP', true],
		['gzip;q=0.5', true],
		['gzip;q=0', false],
		['gzip; q=0.000', false],
		['br', false],
		['', false],
		// Only the literal coding: the body is labelled `gzip`, and `*` promises nothing about it.
		['x-gzip', false],
		['*', false]
	])('%j -> %s', (header, expected) => {
		expect(acceptsGzip(header)).toBe(expected);
	});
});

describe('responseVariant', () => {
	it.each([
		[{ accept: BINARY_SOLVE_MEDIA_TYPE, acceptEncoding: 'gzip' }, 'binary'],
		[{ accept: `${BINARY_SOLVE_MEDIA_TYPE}, application/json;q=0.9` }, 'binary'],
		[{ accept: `${BINARY_SOLVE_MEDIA_TYPE};q=0`, acceptEncoding: 'gzip' }, 'gzip'],
		// A wildcard is every existing client: it keeps getting JSON.
		[{ accept: '*/*', acceptEncoding: 'gzip, br' }, 'gzip'],
		[{ accept: 'application/json', acceptEncoding: 'gzip;q=0' }, 'identity'],
		[{}, 'identity']
	] as const)('%j -> %s', (headers, expected) => {
		expect(responseVariant(headers)).toBe(expected);
	});
});

describe('binary encoding', () => {
	const DISPLAY = 'Selva.GH.Features.Display.Services.DisplayBatch';
	// Random, as a real deflated blob is: gzip finds nothing in it.
	const blobBytes = new Uint8Array(randomBytes(3001));
	const batchJson = (compressedData: string) =>
		JSON.stringify({ materials: [{ id: 0 }], groups: [], compressedData });
	const response = () => ({
		modelunits: 'Millimeters',
		values: [
			{
				ParamName: 'display',
				InnerTree: {
					'{0}': [
						{ type: DISPLAY, data: batchJson(Buffer.from(blobBytes).toString('base64')) },
						{ type: 'System.String', data: '"hello"' }
					]
				}
			},
			{
				ParamName: 'second',
				innerTree: {
					'{0;1}': [{ type: DISPLAY, data: batchJson(Buffer.from([9, 8, 7]).toString('base64')) }]
				}
			}
		]
	});

	it('round-trips through the client decoder with each blob as raw bytes', async () => {
		const original = response();
		const body = encoded(await encoder(original).encode('binary'));
		expect(body.variant).toBe('binary');
		const bytes = body.body as Uint8Array;

		const { response: decodedResponse, releaseBlobs } = await decodeBinarySolveResponse(bytes);
		const decoded = decodedResponse as ReturnType<typeof response>;
		const [first, text] = decoded.values[0]!.InnerTree!['{0}']!;
		const batch = first!.data as unknown as { compressedData: Uint8Array; materials: unknown };
		expect(batch.compressedData).toEqual(blobBytes);
		expect(batch.materials).toEqual([{ id: 0 }]);
		expect(batch.compressedData.byteOffset % 8).toBe(0);
		expect(text).toEqual({ type: 'System.String', data: '"hello"' });
		const second = decoded.values[1]!.innerTree!['{0;1}']![0]!.data as unknown as {
			compressedData: Uint8Array;
		};
		expect([...second.compressedData]).toEqual([9, 8, 7]);
		expect(decoded.modelunits).toBe('Millimeters');
		releaseBlobs();
		expect(batch.compressedData).toBe('');
		expect(batch.materials).toEqual([{ id: 0 }]);
		// The cached response keeps its base64: JSON callers still read it.
		expect(original.values[0]!.InnerTree!['{0}']![0]!.data).toContain('"compressedData":"');
	});

	it('carries each blob at its raw size, never through gzip', async () => {
		const body = encoded(await encoder(response()).encode('binary'));
		expect(body.gzipMs).toBe(0);
		expect((body.body as Uint8Array).byteLength).toBeLessThan(blobBytes.byteLength + 1024);
	});

	it('reuses the binary body for a repeat solve of the same response', async () => {
		const original = response();
		const first = encoded(await encoder(original).encode('binary'));
		const repeat = encoded(await encoder(original).encode('binary'));
		expect(repeat.body).toBe(first.body);
		expect(repeat.serializeMs).toBe(0);
	});

	it('caps on the binary size', async () => {
		expect(await encoder(response(), 100).encode('binary')).toBe('too_large');
	});

	it('frames a response without display items as JSON alone', async () => {
		const plain = {
			values: [{ ParamName: 'n', InnerTree: { '{0}': [{ type: 'System.Double', data: '1' }] } }]
		};
		const body = encoded(await encoder(plain).encode('binary'));
		expect((await decodeBinarySolveResponse(body.body as Uint8Array)).response).toEqual(plain);
	});

	it('rejects a frame that is not one', async () => {
		await expect(decodeBinarySolveResponse(new Uint8Array(32))).rejects.toThrow(/bad magic/);
	});
});

describe('createResponseEncoder', () => {
	it('compresses when gzip is accepted and the body is over 1 KB', async () => {
		const response = big();
		const body = encoded(await encoder(response).encode('gzip'));
		expect(body.variant).toBe('gzip');
		expect(JSON.parse(gunzipSync(body.body as Uint8Array).toString())).toEqual(response);
	});

	it('does not compress when gzip is not accepted', async () => {
		const body = encoded(await encoder(big()).encode('identity'));
		expect(body.variant).toBe('identity');
		expect(typeof body.body).toBe('string');
	});

	it('does not compress a tiny body even with gzip accepted', async () => {
		const body = encoded(await encoder({ ok: 1 }).encode('gzip'));
		expect(body.variant).toBe('identity');
		expect(body.body).toBe('{"ok":1}');
	});

	it('gives each caller of one flight its own encoding', async () => {
		const response = big();
		const flight = encoder(response);
		const [gzipped, plain] = await Promise.all([flight.encode('gzip'), flight.encode('identity')]);
		expect(encoded(gzipped).variant).toBe('gzip');
		expect(JSON.parse(encoded(plain).body as string)).toEqual(response);
	});

	it('stringifies once for every caller of one flight', async () => {
		const spy = vi.spyOn(JSON, 'stringify');
		const flight = encoder(big());
		await Promise.all([
			flight.encode('identity'),
			flight.encode('identity'),
			flight.encode('gzip')
		]);
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});

	it('compresses once for concurrent gzip callers', async () => {
		const flight = encoder(big());
		const [a, b] = await Promise.all([flight.encode('gzip'), flight.encode('gzip')]);
		expect(encoded(a).body).toBe(encoded(b).body);
	});

	it('reuses the gzip body for a later flight on the same response, doing no work', async () => {
		const response = big();
		const first = encoded(await encoder(response).encode('gzip'));
		const spy = vi.spyOn(JSON, 'stringify');
		const repeat = encoded(await encoder(response).encode('gzip'));
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
		expect(repeat.body).toBe(first.body);
		expect(repeat.serializeMs).toBe(0);
		expect(repeat.serializedBytes).toBe(first.serializedBytes);
	});

	it('still answers a client without gzip in plain JSON after gzipping that response', async () => {
		const response = big();
		await encoder(response).encode('gzip');
		const plain = encoded(await encoder(response).encode('identity'));
		expect(JSON.parse(plain.body as string)).toEqual(response);
	});

	it('builds a body per response, never reusing another one', async () => {
		await encoder({ values: 'a'.repeat(5000) }).encode('gzip');
		const second = encoded(await encoder({ values: 'b'.repeat(5000) }).encode('gzip'));
		expect(JSON.parse(gunzipSync(second.body as Uint8Array).toString()).values[0]).toBe('b');
	});

	it('caps on bytes, not UTF-16 units', async () => {
		// 8 characters, 24 bytes: a length check would let this through.
		expect(await encoder({ v: '日本語日本語' }, 20).encode('identity')).toBe('too_large');
	});

	it('reports the byte size of non-ASCII output', async () => {
		const response = { v: '日本語' };
		const body = encoded(await encoder(response).encode('identity'));
		expect(body.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(response)));
	});

	it('remembers too_large for a later gzip caller on the same response', async () => {
		const response = big();
		expect(await encoder(response, 10).encode('gzip')).toBe('too_large');
		const spy = vi.spyOn(JSON, 'stringify');
		expect(await encoder(response, 10).encode('gzip')).toBe('too_large');
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('reads a RangeError from stringify as too_large', async () => {
		const spy = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
			throw new RangeError('Invalid string length');
		});
		expect(await encoder(big()).encode('identity')).toBe('too_large');
		spy.mockRestore();
	});

	it('lets any other stringify failure through', async () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		await expect(encoder(cyclic).encode('identity')).rejects.toThrow(TypeError);
	});
});

describe('buildEnvelope', () => {
	const result = {} as GrasshopperComputeResponse;

	it('labels a plain body with its byte length and the contract version', () => {
		const envelope = buildEnvelope(
			{
				body: '{"v":"日本語"}',
				variant: 'identity',
				serializedBytes: 0,
				serializeMs: 0,
				gzipMs: 0
			},
			result,
			'total;dur=1.0',
			metrics
		);
		expect(envelope.variant).toBe('identity');
		expect(envelope.headers['Content-Encoding']).toBeUndefined();
		expect(envelope.headers['Content-Length']).toBe(
			String(Buffer.byteLength(envelope.body as string))
		);
		expect(envelope.headers[COMPUTE_VERSION_HEADER]).toBe(String(COMPUTE_CONTRACT_VERSION));
		expect(envelope.headers['Content-Type']).toBe('application/json');
		expect(envelope.headers['Server-Timing']).toBe('total;dur=1.0');
	});

	it('labels a gzip body so a proxy leaves it alone', () => {
		const envelope = buildEnvelope(
			{
				body: new Uint8Array(7),
				variant: 'gzip',
				serializedBytes: 0,
				serializeMs: 0,
				gzipMs: 0
			},
			result,
			'',
			metrics
		);
		expect(envelope.variant).toBe('gzip');
		expect(envelope.encoding).toBe('gzip');
		expect(envelope.headers['Content-Encoding']).toBe('gzip');
		expect(envelope.headers['Content-Length']).toBe('7');
		expect(envelope.headers.Vary).toBe('Accept, Accept-Encoding');
	});

	it('labels a binary body with its media type and no Content-Encoding', () => {
		const envelope = buildEnvelope(
			{
				body: new Uint8Array(16),
				variant: 'binary',
				serializedBytes: 0,
				serializeMs: 0,
				gzipMs: 0
			},
			result,
			'',
			metrics
		);
		expect(envelope.headers['Content-Type']).toBe(BINARY_SOLVE_MEDIA_TYPE);
		expect(envelope.headers['Content-Encoding']).toBeUndefined();
		expect(envelope.headers['Content-Length']).toBe('16');
	});
});
