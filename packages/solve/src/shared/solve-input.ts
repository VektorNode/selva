/**
 * The input type both halves solve over.
 *
 * This was declared twice — as `PipelineInput` in `@selvajs/server/compute/solve-pipeline.ts` and as
 * `SolveInput` in Parafa's `solve.server.ts` — with identical bodies. Two declarations of one type
 * are free to drift silently; this is the single one.
 */

import type { SchemaInput } from '@selvajs/schemas';

/**
 * A schema input carrying the optional numeric bounds the input transform reads.
 *
 * The bounds are optional because they are meaningful only for numeric params (slider min/max/step);
 * a text or geometry input carries none and the transform skips them.
 */
export type SolveInput = SchemaInput & {
	minimum?: number;
	maximum?: number;
	stepSize?: number;
};
