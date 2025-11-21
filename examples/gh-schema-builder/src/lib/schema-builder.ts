/**
 * Represents a single field in the output schema
 */
export type SchemaField = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
  isArray: boolean;
  itemType?: string;
  description?: string;
};

/**
 * Represents the complete output schema
 */
export type OutputSchema = {
  fields: Record<string, SchemaField>;
  timestamp: string;
};

/**
 * Infers the type of a value
 */
function inferType(value: unknown): SchemaField['type'] {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null || value === undefined) {
    return 'unknown';
  }
  if (typeof value === 'object') {
    return 'object';
  }
  return typeof value as 'string' | 'number' | 'boolean';
}

/**
 * Infers the item type of an array
 */
function inferItemType(arr: unknown[]): string {
  if (arr.length === 0) return 'unknown';
  const firstItem = arr[0];
  if (Array.isArray(firstItem)) return 'array';
  if (typeof firstItem === 'object' && firstItem !== null) return 'object';
  return typeof firstItem;
}

/**
 * Generates an output schema from response data
 *
 * @param data - The response data object (usually contextPrintData)
 * @returns The generated output schema
 *
 * @example
 * ```typescript
 * const contextPrintData = resultProcessor.getContextPrintData(true, true);
 * const schema = buildOutputSchema(contextPrintData);
 * console.log(schema.fields); // { contextBool: {...}, contextString: {...} }
 * ```
 */
export function buildOutputSchema(data: Record<string, unknown>): OutputSchema {
  const fields: Record<string, SchemaField> = {};

  for (const [key, value] of Object.entries(data)) {
    const baseType = inferType(value);
    const isArray = Array.isArray(value);
    const itemType = isArray ? inferItemType(value as unknown[]) : undefined;

    fields[key] = {
      name: key,
      type: baseType,
      isArray,
      itemType,
    };
  }

  return {
    fields,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generates a TypeScript interface definition from the output schema
 *
 * @param schema - The output schema
 * @param interfaceName - Name for the generated interface (default: 'OutputData')
 * @returns TypeScript interface definition as a string
 *
 * @example
 * ```typescript
 * const schema = buildOutputSchema(contextPrintData);
 * const interfaceDef = generateTypeScriptInterface(schema, 'ComputeOutput');
 * console.log(interfaceDef);
 * // export interface ComputeOutput {
 * //   contextBool: boolean;
 * //   contextString: string | string[];
 * //   ...
 * // }
 * ```
 */
export function generateTypeScriptInterface(
  schema: OutputSchema,
  interfaceName: string = 'OutputData'
): string {
  const lines: string[] = [];
  lines.push(`export interface ${interfaceName} {`);

  for (const field of Object.values(schema.fields)) {
    const typeStr = buildTypeString(field);
    lines.push(`  ${field.name}: ${typeStr};`);
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generates a TypeScript type definition from the output schema
 *
 * @param schema - The output schema
 * @param typeName - Name for the generated type (default: 'OutputData')
 * @returns TypeScript type definition as a string
 *
 * @example
 * ```typescript
 * const schema = buildOutputSchema(contextPrintData);
 * const typeDef = generateTypeScriptInterface(schema, 'ComputeOutput');
 * console.log(typeDef);
 * // export type ComputeOutput = {
 * //   contextBool: boolean;
 * //   contextString: string | string[];
 * //   ...
 * // };
 * ```
 */
export function generateTypeScriptType(
  schema: OutputSchema,
  typeName: string = 'OutputData'
): string {
  const lines: string[] = [];
  lines.push(`export type ${typeName} = {`);

  for (const field of Object.values(schema.fields)) {
    const typeStr = buildTypeString(field);
    lines.push(`  ${field.name}: ${typeStr};`);
  }

  lines.push('};');
  return lines.join('\n');
}

/**
 * Builds a TypeScript type string for a schema field
 */
function buildTypeString(field: SchemaField): string {
  let baseType: string;

  switch (field.type) {
    case 'array':
      baseType = field.itemType || 'unknown';
      return `${baseType}[]`;
    case 'object':
      return 'Record<string, unknown>';
    default:
      baseType = field.type;
  }

  return baseType;
}

/**
 * Validates data against the schema
 *
 * @param data - The data to validate
 * @param schema - The output schema
 * @returns Array of validation errors (empty if valid)
 */
export function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: OutputSchema
): string[] {
  const errors: string[] = [];

  for (const [key, field] of Object.entries(schema.fields)) {
    if (!(key in data)) {
      errors.push(`Missing required field: ${key}`);
      continue;
    }

    const value = data[key];
    const expectedType = field.type;
    const actualType = inferType(value);

    if (expectedType !== actualType) {
      errors.push(
        `Field "${key}" has type "${actualType}", expected "${expectedType}"`
      );
    }
  }

  return errors;
}
