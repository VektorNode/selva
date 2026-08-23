/**
 * The version-compat gate is asymmetric on purpose: newer-than-supported throws
 * 'unsupported', while older / missing versions pass — compute's C# migrator
 * emits its own current version, and older shapes only lack optional additions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';
import type { ComputeServerConfig } from '@selvajs/platform';
import {
	fetchSchemaFromCompute,
	assertSupportedSchemaVersion,
	assertCamelCaseSchema,
	SchemaExtractionError,
	readSchemaResults
} from '../schema-extraction.js';

function schema(version?: string): UISchema {
	return {
		id: 'schema-1',
		name: 'Test',
		...(version !== undefined && { schemaVersion: version }),
		inputs: [],
		outputs: [],
		layout: { type: 'tabbed', tabs: [] }
	} as unknown as UISchema;
}

function bump(version: string, part: 0 | 1 | 2): string {
	const nums = version.split('.').map(Number);
	nums[part] += 1;
	return nums.join('.');
}

const server: ComputeServerConfig = {
	id: 'srv-1',
	serverUrl: 'http://compute.example.com',
	apiKey: 'secret'
} as ComputeServerConfig;

describe('assertSupportedSchemaVersion', () => {
	it('passes the current version', () => {
		expect(() => assertSupportedSchemaVersion(schema(UI_SCHEMA_VERSION))).not.toThrow();
	});

	it('passes older versions (older shapes only lack optional additions)', () => {
		expect(() => assertSupportedSchemaVersion(schema('1.0.0'))).not.toThrow();
		expect(() => assertSupportedSchemaVersion(schema('2.0.0'))).not.toThrow();
	});

	it('passes a schema without a version (pre-2.12.0 plugin)', () => {
		expect(() => assertSupportedSchemaVersion(schema())).not.toThrow();
	});

	it.each([
		['major', 0],
		['minor', 1],
		['patch', 2]
	] as const)('throws unsupported for a newer %s version', (_label, part) => {
		const newer = bump(UI_SCHEMA_VERSION, part);
		try {
			assertSupportedSchemaVersion(schema(newer));
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(SchemaExtractionError);
			expect((err as SchemaExtractionError).kind).toBe('unsupported');
			expect((err as SchemaExtractionError).message).toContain(newer);
			expect((err as SchemaExtractionError).message).toContain(UI_SCHEMA_VERSION);
		}
	});

	it('passes an unparseable version string (fail open — invalid is not "newer")', () => {
		expect(() => assertSupportedSchemaVersion(schema('abc'))).not.toThrow();
	});
});

describe('assertCamelCaseSchema', () => {
	// The real regression: compute serialized the plugin's UISchema with its own
	// Newtonsoft, which ignored the [JsonProperty] attributes and emitted raw CLR
	// member names. Nothing threw — `schema.inputs` was just undefined everywhere.
	const pascalCase = {
		Id: 'schema-1',
		Name: 'Test',
		SchemaVersion: '2.14.0',
		Inputs: [],
		Outputs: [],
		Layout: { Type: 'tabbed', Tabs: [] }
	} as unknown as UISchema;

	it('accepts a camelCase schema', () => {
		expect(() => assertCamelCaseSchema(schema(UI_SCHEMA_VERSION))).not.toThrow();
	});

	it('rejects a PascalCase schema and names the offending keys', () => {
		expect(() => assertCamelCaseSchema(pascalCase)).toThrow(/keys are PascalCase/);
		expect(() => assertCamelCaseSchema(pascalCase)).toThrow(/Inputs/);
	});

	it('classifies a PascalCase schema as malformed', () => {
		expect(() => assertCamelCaseSchema(pascalCase)).toThrowError(
			expect.objectContaining({ name: 'SchemaExtractionError', kind: 'malformed' })
		);
	});

	it('rejects a schema missing inputs entirely', () => {
		expect(() => assertCamelCaseSchema({ id: 'x' } as unknown as UISchema)).toThrow(
			/no 'inputs' array/
		);
	});
});

describe('fetchSchemaFromCompute', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function computeResponse(schemas: unknown[]): Response {
		// Compute wraps results with PascalCase keys.
		return new Response(JSON.stringify([{ FileName: 'definition.gh', Schemas: schemas }]), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	it('extracts the first schema and sends the API key header', async () => {
		fetchMock.mockResolvedValue(computeResponse([schema(UI_SCHEMA_VERSION)]));
		const result = await fetchSchemaFromCompute(new Uint8Array([1]), server);
		expect(result.id).toBe('schema-1');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://compute.example.com/grasshopper/schema');
		expect((init.headers as Record<string, string>)['RhinoComputeKey']).toBe('secret');
	});

	it('throws unreachable when the network request fails', async () => {
		fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
		await expect(fetchSchemaFromCompute(new Uint8Array([1]), server)).rejects.toMatchObject({
			name: 'SchemaExtractionError',
			kind: 'unreachable'
		});
	});

	it('throws unreachable on a non-OK status', async () => {
		fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
		await expect(fetchSchemaFromCompute(new Uint8Array([1]), server)).rejects.toMatchObject({
			kind: 'unreachable'
		});
	});

	it('throws invalid when the definition yields no schemas', async () => {
		fetchMock.mockResolvedValue(computeResponse([]));
		await expect(fetchSchemaFromCompute(new Uint8Array([1]), server)).rejects.toMatchObject({
			kind: 'invalid'
		});
	});

	it("surfaces compute's per-file error message instead of the generic fallback", async () => {
		// Compute diagnoses the definition and still answers 200 with an `error` field,
		// so the non-OK guard never fires. The real message must reach the caller.
		const message = "The 'Schema' source is not coming from a 'UI Builder' component.";
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify([{ FileName: 'definition.gh', error: message }]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await expect(fetchSchemaFromCompute(new Uint8Array([1]), server)).rejects.toMatchObject({
			kind: 'invalid',
			message
		});
	});

	it('falls back to the generic message when compute reports no error field', async () => {
		fetchMock.mockResolvedValue(computeResponse([]));
		await expect(fetchSchemaFromCompute(new Uint8Array([1]), server)).rejects.toMatchObject({
			kind: 'invalid',
			message: expect.stringContaining('No schemas found in definition')
		});
	});

	it('applies the version gate to the extracted schema', async () => {
		fetchMock.mockResolvedValue(computeResponse([schema(bump(UI_SCHEMA_VERSION, 1))]));
		await expect(fetchSchemaFromCompute(new Uint8Array([1]), server)).rejects.toMatchObject({
			kind: 'unsupported'
		});
	});
});

describe('readSchemaResults', () => {
	// The unwrap itself (both server casings, multi-file, content pass-through) is
	// owned and tested by @selvajs/compute. This only pins the re-export, typed to
	// UISchema — deliberately thin, not an oversight.
	it('reads the PascalCase wrapper compute actually sends', () => {
		const [result] = readSchemaResults([{ FileName: 'a.gh', Schemas: [schema()] }]);

		expect(result.schemas).toHaveLength(1);
	});
});
