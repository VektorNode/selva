import { getInputItems, type UISchema } from '@selvajs/schemas';

/**
 * Inputs the schema marks `source.kind === 'server'`. Only the host fills them, through
 * `SolveEngine.solve`'s `boundValues`; without a value there they solve on their schema default.
 * The client sends no value for them, and the server refuses one.
 */
export function serverSourcedInputIds(schema: UISchema): Set<string> {
	return new Set(
		getInputItems(schema)
			.filter((item) => item.source?.kind === 'server')
			.map((item) => item.paramId)
	);
}
