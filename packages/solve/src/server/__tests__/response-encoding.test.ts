import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { GrasshopperComputeResponse } from '@selvajs/compute/grasshopper';
import {
	acceptsGzip,
	buildEnvelope,
	COMPUTE_CONTRACT_VERSION,
	COMPUTE_VERSION_HEADER,
	createResponseEncoder,
	type EncodedBody
} from '../response-encoding.js';

const MB = 1024 * 1024;
const big = () => ({ values: 'x'.repeat(5000) });
const encoder = (response: object, maxBytes = 10 * MB) => createResponseEncoder(response, maxBytes);

function encoded(result: EncodedBody | 'too_large'): EncodedBody {
	if (result === 'too_large') throw new Error('expected a body');
	return result;
}

const metrics = {
	treeBuildMs: 0,
	solveMs: 0,
	serializeMs: 0,
	gzipMs: 0,
	serverTotalMs: 0,
	serializedBytes: 0,
	compressedBytes: null
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

describe('createResponseEncoder', () => {
	it('compresses when gzip is accepted and the body is over 1 KB', async () => {
		const response = big();
		const body = encoded(await encoder(response).encode('gzip, br'));
		expect(body.encoding).toBe('gzip');
		expect(JSON.parse(gunzipSync(body.body as Uint8Array).toString())).toEqual(response);
	});

	it('does not compress when gzip is not accepted', async () => {
		const body = encoded(await encoder(big()).encode('br'));
		expect(body.encoding).toBeUndefined();
		expect(typeof body.body).toBe('string');
	});

	it('does not compress for a client refusing gzip with q=0', async () => {
		const body = encoded(await encoder(big()).encode('gzip;q=0'));
		expect(body.encoding).toBeUndefined();
	});

	it('does not compress a tiny body even with gzip accepted', async () => {
		const body = encoded(await encoder({ ok: 1 }).encode('gzip'));
		expect(body.encoding).toBeUndefined();
		expect(body.body).toBe('{"ok":1}');
	});

	it('gives each caller of one flight its own encoding', async () => {
		const response = big();
		const flight = encoder(response);
		const [gzipped, plain] = await Promise.all([flight.encode('gzip'), flight.encode('')]);
		expect(encoded(gzipped).encoding).toBe('gzip');
		expect(JSON.parse(encoded(plain).body as string)).toEqual(response);
	});

	it('stringifies once for every caller of one flight', async () => {
		const spy = vi.spyOn(JSON, 'stringify');
		const flight = encoder(big());
		await Promise.all([flight.encode(''), flight.encode(''), flight.encode('gzip')]);
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
		const plain = encoded(await encoder(response).encode('br'));
		expect(JSON.parse(plain.body as string)).toEqual(response);
	});

	it('builds a body per response, never reusing another one', async () => {
		await encoder({ values: 'a'.repeat(5000) }).encode('gzip');
		const second = encoded(await encoder({ values: 'b'.repeat(5000) }).encode('gzip'));
		expect(JSON.parse(gunzipSync(second.body as Uint8Array).toString()).values[0]).toBe('b');
	});

	it('caps on bytes, not UTF-16 units', async () => {
		// 8 characters, 24 bytes: a length check would let this through.
		expect(await encoder({ v: '日本語日本語' }, 20).encode('')).toBe('too_large');
	});

	it('reports the byte size of non-ASCII output', async () => {
		const response = { v: '日本語' };
		const body = encoded(await encoder(response).encode(''));
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
		expect(await encoder(big()).encode('')).toBe('too_large');
		spy.mockRestore();
	});

	it('lets any other stringify failure through', async () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		await expect(encoder(cyclic).encode('')).rejects.toThrow(TypeError);
	});
});

describe('buildEnvelope', () => {
	const result = {} as GrasshopperComputeResponse;

	it('labels a plain body with its byte length and the contract version', () => {
		const envelope = buildEnvelope(
			{ body: '{"v":"日本語"}', serializedBytes: 0, serializeMs: 0, gzipMs: 0 },
			result,
			'total;dur=1.0',
			metrics
		);
		expect(envelope.encoding).toBeUndefined();
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
				encoding: 'gzip',
				serializedBytes: 0,
				serializeMs: 0,
				gzipMs: 0
			},
			result,
			'',
			metrics
		);
		expect(envelope.encoding).toBe('gzip');
		expect(envelope.headers['Content-Encoding']).toBe('gzip');
		expect(envelope.headers['Content-Length']).toBe('7');
		expect(envelope.headers.Vary).toBe('Accept-Encoding');
	});
});
