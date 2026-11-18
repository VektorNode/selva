import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { lateSavedValues } from '../saved-values.js';

function schema(inputs: unknown[]): UISchema {
	return { inputs, outputs: [] } as unknown as UISchema;
}

describe('lateSavedValues', () => {
	const before = schema([
		{ id: 'width', paramType: 'number' },
		{ id: 'label', paramType: 'text', default: 'old' },
		{ id: 'count', paramType: 'integer', default: 3 }
	]);
	const after = schema([
		{ id: 'width', paramType: 'number', default: 1200 },
		{ id: 'label', paramType: 'text', default: 'new' },
		{ id: 'count', paramType: 'integer', default: 3 }
	]);

	it('fills inputs still at the value the form started with', () => {
		const current = { width: 0, label: 'old', count: 3 };
		expect(lateSavedValues(before, after, current)).toEqual({ width: 1200, label: 'new' });
	});

	it('keeps an input the user edited', () => {
		const current = { width: 800, label: 'old', count: 3 };
		expect(lateSavedValues(before, after, current)).toEqual({ label: 'new' });
	});

	it('leaves a client-sourced input the form holds no value for', () => {
		const current = { label: 'old', count: 3 };
		expect(lateSavedValues(before, after, current)).toEqual({ label: 'new' });
	});

	it('returns nothing when the stored defaults were already the saved values', () => {
		expect(lateSavedValues(after, after, { width: 1200, label: 'new', count: 3 })).toEqual({});
	});
});
