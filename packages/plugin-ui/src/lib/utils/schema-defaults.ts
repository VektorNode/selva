// Pure schema-normalisation helpers, split out of session.ts so they can be imported by
// node-env logic (the builder/preview cores and their tests) without pulling in SvelteKit's
// `$app/state` or the WebSocket transport that the rest of session.ts depends on.

import type { UISchema, DiscoveredParameters } from '@selvajs/schemas';

/** Ensure a schema has a usable layout + instanceSolve default. Mutates and returns it. */
export function ensureSchemaLayoutDefaults(schema: UISchema | null): UISchema | null {
	if (!schema) return null;

	if (!schema.layout) {
		schema.layout = {
			type: 'tabbed',
			gap: 16,
			tabs: []
		};
	}

	if (schema.layout.type === 'tabbed' && !schema.layout.tabs) {
		schema.layout.tabs = [];
	}
	if (schema.instanceSolve === undefined) {
		schema.instanceSolve = true;
	}

	return schema;
}

/**
 * Process an initial-data message and extract the schema (with defaults) plus the available
 * inputs/outputs. Default schema creation is handled by the C# UIBuilderComponent, which
 * includes document metadata (projectFileName, documentId).
 */
export function processInitialDataSchema(message: {
	schema?: UISchema;
	availableParams?: DiscoveredParameters;
}): {
	schema: UISchema | null;
	availableInputs: DiscoveredParameters['inputs'];
	availableOutputs: DiscoveredParameters['outputs'];
} {
	const availableInputs = message.availableParams?.inputs || [];
	const availableOutputs = message.availableParams?.outputs || [];
	let schema = message.schema || null;

	if (schema) {
		schema = ensureSchemaLayoutDefaults(schema);
	}

	return { schema, availableInputs, availableOutputs };
}
