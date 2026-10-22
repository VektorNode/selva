import type { SchemaInput } from '@selvajs/schemas';

/**
 * A schema input carrying the optional numeric bounds tree building clamps to. Only numeric params
 * (sliders) carry them; text or geometry inputs carry none.
 */
export type SolveInput = SchemaInput & {
	minimum?: number;
	maximum?: number;
};
