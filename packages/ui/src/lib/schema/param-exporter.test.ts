import { describe, expect, it } from 'vitest';
import { validateSavedState, extractLoadableValues } from './param-exporter';
import type { UISchema, ParameterPreset } from '@selvajs/schemas';

// These tests cover the load path a user hits when restoring a preset against a
// schema that has drifted. The severity of each mismatch decides whether the
// preset can load at all (error blocks, warning allows), so those are the cases
// worth locking in — not the happy path.

function schema(over: Partial<UISchema> = {}): UISchema {
	return {
		id: 'schema-1',
		documentId: 'doc-1',
		inputs: [
			{ id: 'a', nickname: 'A', paramType: 'number' },
			{ id: 'b', nickname: 'B', paramType: 'number' }
		],
		...over
	} as unknown as UISchema;
}

function preset(over: Partial<ParameterPreset> = {}): ParameterPreset {
	return {
		id: 'p1',
		name: 'My Preset',
		schemaId: 'schema-1',
		documentId: 'doc-1',
		parameters: [
			{ paramId: 'a', nickname: 'A', value: 1 },
			{ paramId: 'b', nickname: 'B', value: 2 }
		],
		...over
	} as unknown as ParameterPreset;
}

describe('validateSavedState', () => {
	it('document-ID mismatch is a blocking error', () => {
		const result = validateSavedState(preset({ documentId: 'other-doc' }), schema());
		expect(result.canLoad).toBe(false);
		expect(result.issues.some((i) => i.severity === 'error' && i.paramId === '__document__')).toBe(
			true
		);
	});

	it('schema-ID change is a warning that still allows loading', () => {
		const result = validateSavedState(preset({ schemaId: 'old-schema' }), schema());
		expect(result.canLoad).toBe(true);
		expect(result.isValid).toBe(false);
		expect(result.issues.some((i) => i.severity === 'warning' && i.paramId === '__schema__')).toBe(
			true
		);
	});

	it('a parameter missing from the schema is a blocking error', () => {
		const p = preset({
			parameters: [
				{ paramId: 'a', nickname: 'A', value: 1 },
				{ paramId: 'gone', nickname: 'Gone', value: 9 }
			] as ParameterPreset['parameters']
		});
		const result = validateSavedState(p, schema());
		expect(result.canLoad).toBe(false);
		expect(result.issues.some((i) => i.severity === 'error' && i.paramId === 'gone')).toBe(true);
	});

	it('a renamed nickname is a warning, not a block', () => {
		const renamed = schema({
			inputs: [
				{ id: 'a', nickname: 'A renamed', paramType: 'number' },
				{ id: 'b', nickname: 'B', paramType: 'number' }
			]
		} as unknown as Partial<UISchema>);
		const result = validateSavedState(preset(), renamed);
		expect(result.canLoad).toBe(true);
		expect(result.issues.some((i) => i.severity === 'warning' && i.paramId === 'a')).toBe(true);
	});

	it('a fully matching preset is valid with no issues', () => {
		const result = validateSavedState(preset(), schema());
		expect(result).toEqual({ isValid: true, issues: [], canLoad: true });
	});
});

describe('extractLoadableValues', () => {
	it('drops params flagged as errors but keeps the rest', () => {
		const p = preset({
			parameters: [
				{ paramId: 'a', nickname: 'A', value: 1 },
				{ paramId: 'gone', nickname: 'Gone', value: 9 } // not in schema -> error
			] as ParameterPreset['parameters']
		});
		const s = schema();
		const validation = validateSavedState(p, s);
		expect(extractLoadableValues(p, s, validation)).toEqual({ a: 1 });
	});

	it('keeps a warned-but-valid param (nickname drift) on load', () => {
		const renamed = schema({
			inputs: [
				{ id: 'a', nickname: 'A renamed', paramType: 'number' },
				{ id: 'b', nickname: 'B', paramType: 'number' }
			]
		} as unknown as Partial<UISchema>);
		const validation = validateSavedState(preset(), renamed);
		expect(extractLoadableValues(preset(), renamed, validation)).toEqual({ a: 1, b: 2 });
	});
});
