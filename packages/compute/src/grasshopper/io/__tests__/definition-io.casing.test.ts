// The `/io` body parses identically in either server casing, and the keys of a
// value-list `values` map (user-authored dropdown labels) round-trip verbatim.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchDefinitionIO, fetchParsedDefinitionIO } from '../definition-io';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const CONFIG = { serverUrl: 'http://localhost:6500' };

afterEach(() => fetchMock.mockReset());

/** A realistic camelCase /io response with a value-list input. */
function ioResponse() {
	return {
		description: '',
		filename: '',
		cachekey: 'abc',
		inputnames: ['Size'],
		outputnames: ['Geo'],
		icon: null,
		inputs: [
			{
				id: 'guid-1',
				name: 'Size',
				nickname: 'Size',
				description: 'pick a size',
				paramType: 'ValueList',
				treeAccess: false,
				atLeast: 1,
				atMost: 1,
				groupName: 'Settings::Dimensions',
				values: {
					'Option A': '1',
					'Option B': '2',
					Small: '10',
					'Extra Large': '40'
				}
			}
		],
		outputs: [{ name: 'Geo', nickname: 'Geo', paramType: 'Geometry', id: 'guid-2' }],
		warnings: [],
		errors: []
	};
}

describe('fetchDefinitionIO casing seam', () => {
	it('preserves value-list keys verbatim (does not camelCase dropdown labels)', async () => {
		fetchMock.mockResolvedValue(createMockResponse(ioResponse()));

		const { inputs } = await fetchDefinitionIO('https://example.com/d.gh', CONFIG);
		const values = inputs[0].values!;

		// These are user-facing labels — they MUST survive exactly.
		expect(Object.keys(values)).toEqual(['Option A', 'Option B', 'Small', 'Extra Large']);
		expect(values['Option A']).toBe('1');
		expect(values['Extra Large']).toBe('40');
		// And must NOT have been camelCased.
		expect(values).not.toHaveProperty('optionA');
		expect(values).not.toHaveProperty('extraLarge');
	});

	it('surfaces the camelCase fields the parser reads', async () => {
		fetchMock.mockResolvedValue(createMockResponse(ioResponse()));

		const { inputs, outputs } = await fetchDefinitionIO('https://example.com/d.gh', CONFIG);

		expect(inputs[0]).toMatchObject({
			id: 'guid-1',
			name: 'Size',
			paramType: 'ValueList',
			treeAccess: false,
			groupName: 'Settings::Dimensions'
		});
		expect(outputs[0]).toMatchObject({ name: 'Geo', paramType: 'Geometry', id: 'guid-2' });
	});
});

/**
 * A PascalCase `/io` body as emitted by an upstream-tracking server branch
 * (`8.x.selva`): top-level `Inputs`/`Outputs`, per-param `ParamType`/`Minimum`/
 * `Name`/… with only `id`/`groupName`/`values` lowercased (the fields that DO
 * carry `[JsonProperty]`).
 */
function pascalIoResponse() {
	return {
		Description: '',
		Filename: '',
		CacheKey: 'abc',
		InputNames: ['Radius'],
		OutputNames: ['Geo'],
		Icon: null,
		Inputs: [
			{
				id: 'guid-1',
				Name: 'Radius',
				Nickname: 'R',
				Description: 'the radius',
				ParamType: 'Number',
				TreeAccess: false,
				Minimum: 1,
				Maximum: 100,
				AtLeast: 1,
				AtMost: 1,
				groupName: 'Dims',
				Default: 5
			}
		],
		Outputs: [{ Name: 'Geo', Nickname: 'G', ParamType: 'Geometry', Id: 'guid-2' }],
		Warnings: [],
		Errors: []
	};
}

describe('fetchDefinitionIO parses a PascalCase server response (8.x.selva)', () => {
	it('reads top-level Inputs/Outputs and per-param PascalCase fields', async () => {
		fetchMock.mockResolvedValue(createMockResponse(pascalIoResponse()));

		const { inputs, outputs } = await fetchDefinitionIO('https://example.com/d.gh', CONFIG);

		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({
			id: 'guid-1',
			name: 'Radius',
			nickname: 'R',
			description: 'the radius',
			paramType: 'Number',
			treeAccess: false,
			minimum: 1,
			maximum: 100,
			atLeast: 1,
			atMost: 1,
			groupName: 'Dims'
		});
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({
			name: 'Geo',
			nickname: 'G',
			paramType: 'Geometry',
			id: 'guid-2'
		});
	});

	it('parses through to typed inputs with the PascalCase default intact', async () => {
		fetchMock.mockResolvedValue(createMockResponse(pascalIoResponse()));

		const { inputs } = await fetchParsedDefinitionIO('https://example.com/d.gh', CONFIG);

		expect(inputs).toHaveLength(1);
		const input = inputs[0];
		expect(input.paramType).toBe('Number');
		if (input.paramType === 'Number') {
			// Default read from PascalCase `Default`, min/max from `Minimum`/`Maximum`.
			expect(input.default).toBe(5);
			expect(input.minimum).toBe(1);
			expect(input.maximum).toBe(100);
		}
	});

	it('parses the camelCase twin identically (attributes present on 8.x.selva)', async () => {
		// The same definition served with [JsonProperty("camelCase")] attributes
		// present — must produce the exact same typed result as the PascalCase body.
		const camel = {
			description: '',
			filename: '',
			cachekey: 'abc',
			inputnames: ['Radius'],
			outputnames: ['Geo'],
			icon: null,
			inputs: [
				{
					id: 'guid-1',
					name: 'Radius',
					nickname: 'R',
					description: 'the radius',
					paramType: 'Number',
					treeAccess: false,
					minimum: 1,
					maximum: 100,
					atLeast: 1,
					atMost: 1,
					groupName: 'Dims',
					default: 5
				}
			],
			outputs: [{ name: 'Geo', nickname: 'G', paramType: 'Geometry', id: 'guid-2' }],
			warnings: [],
			errors: []
		};
		fetchMock.mockResolvedValue(createMockResponse(camel));

		const { inputs, outputs } = await fetchParsedDefinitionIO('https://example.com/d.gh', CONFIG);
		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({ name: 'Radius', paramType: 'Number', default: 5 });
		expect(outputs[0]).toMatchObject({ name: 'Geo', paramType: 'Geometry', id: 'guid-2' });
	});
});
