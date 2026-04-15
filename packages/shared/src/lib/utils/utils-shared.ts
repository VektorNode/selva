import type { UISchema } from '$lib/types/generated';

/**
 * Get default value for a parameter type
 */
export function getDefaultValue(paramType: string): unknown {
	switch (paramType) {
		case 'number':
		case 'integer':
			return 0;
		case 'boolean':
			return false;
		case 'text':
			return '';
		default:
			return null;
	}
}

/**
 * Ensure schema has proper layout defaults
 */
export function ensureSchemaLayoutDefaults(schema: UISchema | null): UISchema | null {
	if (!schema) return null;

	if (!schema.layout) {
		schema.layout = {
			type: 'tabbed',
			gap: 16,
			tabs: []
		};
	}

	/**
	 * @deprecated v1 schema migration
	 * TODO(v2.0.0): Remove this block - all schemas should have layout.type
	 */
	if (schema.layout && !schema.layout.type) {
		if ('tabs' in schema.layout) {
			(schema.layout as any).type = 'tabbed';
		} else if ('groups' in schema.layout) {
			(schema.layout as any).type = 'flat';
		} else {
			(schema.layout as any).type = 'tabbed';
		}
	}

	if (schema.layout.type === 'tabbed' && !schema.layout.tabs) {
		schema.layout.tabs = [];
	}
	if (schema.instanceSolve === undefined) {
		schema.instanceSolve = true;
	}

	return schema;
}
