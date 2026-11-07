import { getInputItems, type UISchema } from '@selvajs/schemas';

/**
 * Inputs the schema marks `source.kind === 'server'`. No resolver fills them, so they solve with
 * their schema default: the client sends no value for them, and the server refuses one.
 */
export function serverSourcedInputIds(schema: UISchema): Set<string> {
	return new Set(
		getInputItems(schema)
			.filter((item) => item.source?.kind === 'server')
			.map((item) => item.paramId)
	);
}
