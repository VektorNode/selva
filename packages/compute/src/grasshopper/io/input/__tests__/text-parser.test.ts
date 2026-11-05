import { describe, expect, it } from 'vitest';
import { INPUT_TYPE_PARSERS } from '@/grasshopper/io/input/input-type-parsers';
import { createInputSchema } from '@tests/helpers/test-data-builders';
import type { BaseInputType, InputParamSchema, TextInputType } from '@/grasshopper/types';

const base: BaseInputType = {
	description: '',
	name: 'test',
	nickname: 'T',
	treeAccess: false,
	groupName: ''
};

const textSchema = (overrides: Partial<InputParamSchema>) =>
	createInputSchema({ paramType: 'Text', ...overrides });

function parseText(schema: InputParamSchema) {
	return INPUT_TYPE_PARSERS.get('Text')!.parse(schema, base) as TextInputType;
}

describe('text parser', () => {
	describe('quote removal', () => {
		it.each([
			['"Hello World"', 'Hello World'],
			['""', '']
		])('should remove the surrounding quotes from %s', (quoted, expected) => {
			expect(parseText(textSchema({ default: quoted })).default).toBe(expected);
		});

		it('should not modify unquoted strings', () => {
			expect(parseText(textSchema({ default: 'Hello World' })).default).toBe('Hello World');
		});

		it('strips only the leading quote when the trailing quote is missing', () => {
			expect(parseText(textSchema({ default: '"abc' })).default).toBe('abc');
		});

		it('keeps a string that only ends with a quote intact', () => {
			expect(parseText(textSchema({ default: 'abc"' })).default).toBe('abc"');
		});
	});

	describe('array handling', () => {
		it('should process arrays of quoted strings', () => {
			const result = parseText(textSchema({ default: ['"Hello"', '"World"', '"Test"'] }));
			expect(result.default).toEqual(['Hello', 'World', 'Test']);
		});

		it('should filter non-string values', () => {
			const result = parseText(textSchema({ default: ['"Hello"', 123, null, '"World"'] }));
			expect(result.default).toEqual(['Hello', 'World']);
		});
	});

	describe('real-world scenarios', () => {
		it('should process file paths with escaped backslashes', () => {
			const result = parseText(textSchema({ default: ['"C:\\\\file1.txt"', '"C:\\\\file2.txt"'] }));
			expect(result.default).toEqual(['C:\\\\file1.txt', 'C:\\\\file2.txt']);
		});
	});
});
