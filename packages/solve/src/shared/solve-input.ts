import type { SchemaInput } from '@selvajs/schemas';

/**
 * A schema input carrying the optional numeric bounds the input transform reads. Bounds are optional
 * because they're only meaningful for numeric params (slider min/max/step) — text or geometry inputs
 * carry none.
 */
export type SolveInput = SchemaInput & {
	minimum?: number;
	maximum?: number;
	stepSize?: number;
};
