/**
 * Tests for `transformInputParameter` — the adapter that turns a persisted `SchemaInput`
 * (plus the user's chosen value) into the `@selvajs/compute` `InputParam` that
 * `TreeBuilder.fromInputParams` serializes for the solve.
 *
 * The adapter delegates to the package's `processInput`, so these assert the
 * package-aligned behavior: correct `paramType` for every type (not the old
 * coerce-everything-to-Text), and `default` carrying the user's value. Where a value/
 * default is absent, `processInput` leaves `default` undefined and `fromInputParams`
 * omits the input entirely — letting Grasshopper use its own internal default rather
 * than forcing `''`/`false`.
 */

import { describe, it, expect } from 'vitest';
import { transformInputParameter } from '../+server.js';
import type { SchemaInput } from '@selvajs/schemas';

type Input = SchemaInput & { minimum?: number; maximum?: number; stepSize?: number };

function input(partial: Partial<Input>): Input {
	return {
		id: 'id-1',
		nickname: 'Param',
		paramType: 'text',
		...partial
	} as Input;
}

describe('transformInputParameter — identity fields', () => {
	it('carries id, name, nickname, description through', () => {
		const out = transformInputParameter(
			input({ id: 'guid-x', nickname: 'Width', description: 'the width' }),
			5
		);
		expect(out.id).toBe('guid-x');
		expect(out.name).toBe('Width');
		expect(out.nickname).toBe('Width');
		expect(out.description).toBe('the width');
	});

	it('defaults a blank nickname to null and an absent description to empty string', () => {
		const out = transformInputParameter(input({ nickname: '', description: undefined }), 'v');
		expect(out.nickname).toBeNull();
		expect(out.description).toBe('');
	});
});

describe('transformInputParameter — number / integer', () => {
	it('maps number with the user value winning over the schema default', () => {
		const out = transformInputParameter(
			input({ paramType: 'number', default: 1, minimum: 0, maximum: 10, stepSize: 0.5 }),
			7
		);
		expect(out).toMatchObject({ paramType: 'Number', default: 7, minimum: 0, maximum: 10 });
	});

	it('falls back to the schema default when no value is supplied', () => {
		const out = transformInputParameter(input({ paramType: 'number', default: 3 }), undefined);
		expect(out.default).toBe(3);
	});

	it('forces stepSize to 1 for integers', () => {
		const out = transformInputParameter(
			input({ paramType: 'integer', stepSize: 0.5, default: 2 }),
			4
		);
		expect(out).toMatchObject({ paramType: 'Integer', stepSize: 1, default: 4 });
	});
});

describe('transformInputParameter — text', () => {
	it('maps text and keeps the user value', () => {
		const out = transformInputParameter(input({ paramType: 'text', default: 'd' }), 'hello');
		expect(out).toMatchObject({ paramType: 'Text', default: 'hello' });
	});

	it('falls back to the schema default when no value is supplied', () => {
		expect(
			transformInputParameter(input({ paramType: 'text', default: 'd' }), undefined).default
		).toBe('d');
	});

	it('leaves default undefined when neither value nor schema default exist (input is then omitted)', () => {
		// processInput does not force ''. fromInputParams filters undefined defaults, so the
		// param is simply not sent and Grasshopper uses its own internal default.
		expect(
			transformInputParameter(input({ paramType: 'text', default: undefined }), undefined).default
		).toBeUndefined();
	});
});

describe('transformInputParameter — boolean', () => {
	it('maps boolean and preserves an explicit false (the bug-prone case)', () => {
		const out = transformInputParameter(input({ paramType: 'boolean', default: true }), false);
		expect(out).toMatchObject({ paramType: 'Boolean', default: false });
	});

	it('falls back to the schema default when no value is supplied', () => {
		expect(
			transformInputParameter(input({ paramType: 'boolean', default: true }), undefined).default
		).toBe(true);
	});

	it('leaves default undefined when neither value nor schema default exist (input is then omitted)', () => {
		expect(
			transformInputParameter(input({ paramType: 'boolean', default: undefined }), undefined)
				.default
		).toBeUndefined();
	});
});

describe('transformInputParameter — value-list / file / color / generic', () => {
	// The regression that motivated the swap: these used to be silently coerced to Text.
	// processInput now types them correctly. (The options map for ValueList isn't carried
	// on SchemaInput, so `values` is empty and the selected value rides on `default` —
	// which is exactly the string a contextual ValueList param consumes.)
	it('maps valueList to ValueList, carrying the selected value', () => {
		const out = transformInputParameter(input({ paramType: 'valueList', default: '0' }), '1');
		expect(out).toMatchObject({ paramType: 'ValueList', default: '1' });
	});

	it('maps file to File', () => {
		const out = transformInputParameter(input({ paramType: 'file' }), { fileName: 'a.3dm' });
		expect(out.paramType).toBe('File');
	});

	it('maps color to Color, carrying the value', () => {
		const out = transformInputParameter(input({ paramType: 'color' }), '255,0,0');
		expect(out).toMatchObject({ paramType: 'Color', default: '255,0,0' });
	});

	it('maps generic to the package fallback type (Geometry), not Text', () => {
		const out = transformInputParameter(input({ paramType: 'generic', default: 'd' }), undefined);
		expect(out.paramType).toBe('Geometry');
	});
});
