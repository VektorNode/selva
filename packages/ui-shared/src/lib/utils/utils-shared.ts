import type { UISchema } from '$lib/types/generated';

//TODO: ALL OF THIS SHOULD ONLY GO TO THE BUILDER PACKAGE

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
      tabs: [],
    };
  }

  // Migration for v1 schemas (missing layout.type)
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
  // Ensure instanceSolve has a default value
  if (schema.instanceSolve === undefined) {
    schema.instanceSolve = true;
  }

  return schema;
}
