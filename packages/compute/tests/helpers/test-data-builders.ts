import type { InputParamSchema } from '@/grasshopper/types';

/**
 * Base builder for InputParamSchema with sensible defaults
 * Eliminates repetition of creating 8-line objects in tests
 *
 * @example
 * ```typescript
 * // Instead of:
 * const input: InputParamSchema = {
 *   name: 'test',
 *   nickname: 'T',
 *   description: '',
 *   paramType: 'Number',
 *   default: 42,
 *   treeAccess: false,
 *   groupName: null,
 *   minimum: null,
 *   maximum: null,
 *   atLeast: 1,
 *   atMost: 1,
 * };
 *
 * // Use:
 * const input = createInputSchema({ paramType: 'Number', default: 42 });
 * ```
 */
export function createInputSchema(overrides: Partial<InputParamSchema> = {}): InputParamSchema {
	return {
		id: 'test-id',
		name: 'test',
		nickname: 'T',
		description: '',
		paramType: 'Number',
		treeAccess: false,
		groupName: null,
		minimum: null,
		maximum: null,
		atLeast: 1,
		atMost: 1,
		default: null,
		...overrides
	};
}
