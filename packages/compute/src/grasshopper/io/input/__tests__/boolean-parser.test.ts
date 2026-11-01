import { describe, expect, it } from 'vitest';
import { INPUT_TYPE_PARSERS } from '@/grasshopper/io/input/input-type-parsers';
import { createInputSchema } from '@tests/helpers/test-data-builders';
import { ComputeError } from '@/core';
import type { BaseInputType, InputParamSchema, BooleanInputType } from '@/grasshopper/types';

const base: BaseInputType = {
	description: '',
	name: 'test',
	nickname: 'T',
	treeAccess: false,
	groupName: ''
};

const booleanSchema = (overrides: Partial<InputParamSchema>) =>
	createInputSchema({ paramType: 'Boolean', ...overrides });

function parseBoolean(schema: InputParamSchema) {
	return INPUT_TYPE_PARSERS.get('Boolean')!.parse(schema, base) as BooleanInputType;
}

describe('boolean parser', () => {
	describe('string conversions', () => {
		it('should convert string booleans (case-insensitive)', () => {
			expect(parseBoolean(booleanSchema({ default: 'true' })).default).toBe(true);
			expect(parseBoolean(booleanSchema({ default: 'FALSE' })).default).toBe(false);
		});

		it('should throw error for invalid boolean string', () => {
			const input = booleanSchema({ default: 'invalid' });
			expect(() => parseBoolean(input)).toThrow(ComputeError);
		});
	});

	describe('array handling', () => {
		it('should convert arrays of string booleans', () => {
			const result = parseBoolean(booleanSchema({ default: ['true', 'False', 'TRUE'] }));
			expect(result.default).toEqual([true, false, true]);
		});

		it('should filter non-boolean values', () => {
			const result = parseBoolean(booleanSchema({ default: [true, 123, 'false', null] }));
			expect(result.default).toEqual([true, false]);
		});
	});
});
