import { toCamelCase } from '@/core/utils';

import { FileData } from '../../../file-handling/types';
import { GrasshopperComputeResponse, OutputType, DataItem } from '../../types';

import { decodeRhinoGeometry } from './rhino-decoder';

// Re-export DataItem for backward compatibility
export type { DataItem };

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedContext {
  [key: string]: any;
}

export interface GetValuesOptions {
  /** Filter by specific output types (e.g., 'System.String'). Defaults to all types. */
  types?: OutputType | OutputType[];
  /** Shorthand for types: ['System.String'] */
  stringOnly?: boolean;
  /** Parse string values to primitives (number/boolean). Defaults to true. */
  parseValues?: boolean;
  /** Convert parameter names to camelCase. Defaults to true. */
  toCamelCase?: boolean;
  /** Generate TypeScript type definitions. When true, returns types in result. */
  generateTypes?: boolean;
  /** rhino3dm module instance for decoding geometry. When provided, automatically decodes Rhino objects. */
  rhino?: any; // RhinoModule type
}

export interface TypeInfo {
  /** TypeScript interface string - ready to copy-paste */
  interface: string;
  /** Complete TypeScript type definition with const assertion - ready to copy-paste */
  fullType: string;
}

/**
 * Result from getValues() - contains parsed values with optional type definitions
 */
export interface GetValuesResult<T = ParsedContext> {
  /** Parsed values from the response with full type safety when T is provided */
  values: T;
  /**
   * TypeScript type definitions - only present when using getValuesWithTypes()
   * Copy these into your code for full type safety
   */
  types?: TypeInfo;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const FILE_DATA_TYPE = 'FileData';
const SYSTEM_STRING = 'System.String';
const SYSTEM_INT32 = 'System.Int32';
const SYSTEM_DOUBLE = 'System.Double';
const SYSTEM_BOOLEAN = 'System.Boolean';
const RHINO_GEOMETRY_PREFIX = 'Rhino.Geometry.';
const THREE_DISPLAY_TYPE = 'ThreeDisplay';

// ============================================================================
// JSON & PRIMITIVE PARSING
// ============================================================================

/**
 * Safely parse JSON data that may be double-encoded
 */
function parseJsonSafe(data: string): any {
  try {
    const firstParse = JSON.parse(data);
    if (typeof firstParse === 'string') {
      try {
        return JSON.parse(firstParse);
      } catch {
        return firstParse;
      }
    }
    return firstParse;
  } catch {
    return data;
  }
}

/**
 * Parse string values to primitives (number/boolean) if possible
 */
function parsePrimitive(value: string): string | number | boolean {
  const num = Number(value);
  if (!isNaN(num)) return num;

  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;

  return value;
}

/**
 * Parse and clean string value from DataItem
 */
function parseStringValue(data: string, shouldParse: boolean): string | number | boolean {
  let stringValue: string;
  try {
    stringValue = JSON.parse(data);
  } catch {
    stringValue = data;
  }

  // Remove surrounding quotes if present
  if (typeof stringValue === 'string') {
    stringValue = stringValue.replace(/^"(.*)"$/, '$1');
  }

  return shouldParse ? parsePrimitive(stringValue) : stringValue;
}

// ============================================================================
// TYPE FILTERING & INFERENCE
// ============================================================================

/**
 * Check if item matches type filter
 */
function matchesTypeFilter(itemType: string, filter?: OutputType | OutputType[]): boolean {
  if (!filter) return true;
  if (Array.isArray(filter)) return filter.includes(itemType as OutputType);
  return itemType === filter;
}

/**
 * Check if type should be excluded from value extraction
 */
function isExcludedType(type: string): boolean {
  return type === FILE_DATA_TYPE || type.includes(THREE_DISPLAY_TYPE);
}

/**
 * Infer TypeScript type from runtime value
 */
function inferType(value: any, rhinoType?: string): string {
  if (value === null || value === undefined) return 'unknown';

  if (Array.isArray(value)) {
    const elementType = value.length > 0 ? inferType(value[0]) : 'unknown';
    return `${elementType}[]`;
  }

  const primitiveType = typeof value;
  if (primitiveType === 'boolean') return 'boolean';
  if (primitiveType === 'number') return 'number';
  if (primitiveType === 'string') return 'string';

  if (primitiveType === 'object') {
    return inferRhinoType(rhinoType);
  }

  return 'unknown';
}

/**
 * Infer TypeScript type from Rhino type string
 */
function inferRhinoType(rhinoType?: string): string {
  if (!rhinoType) return 'Record<string, any>';

  if (rhinoType.startsWith(RHINO_GEOMETRY_PREFIX)) {
    let geometryType = rhinoType.replace(RHINO_GEOMETRY_PREFIX, '');
    // Point3d is parsed as Point in rhino3dm
    if (geometryType === 'Point3d') {
      geometryType = 'Point';
    }
    return geometryType;
  }

  if (rhinoType === FILE_DATA_TYPE) {
    return 'FileData';
  }

  return 'Record<string, any>';
}

// ============================================================================
// VALUE EXTRACTION
// ============================================================================

/**
 * Extract and parse value from DataItem based on type
 */
function extractItemValue(entry: DataItem, parseValues: boolean, rhino?: any): any {
  const { type, data } = entry;

  if (isExcludedType(type)) return null;

  try {
    switch (type) {
      case SYSTEM_STRING:
        return parseStringValue(data, parseValues);

      case SYSTEM_INT32:
        return parseInt(JSON.parse(data), 10);

      case SYSTEM_DOUBLE:
        return parseFloat(JSON.parse(data));

      case SYSTEM_BOOLEAN:
        return JSON.parse(data) === true || data === 'True';

      default:
        return extractComplexValue(type, data, rhino);
    }
  } catch {
    return data;
  }
}

/**
 * Extract complex value (geometry, objects, etc.)
 */
function extractComplexValue(type: string, data: string, rhino?: any): any {
  const parsed = parseJsonSafe(data);

  // Decode Rhino geometry if rhino module provided
  if (rhino && type.startsWith(RHINO_GEOMETRY_PREFIX)) {
    return decodeRhinoGeometry(parsed, type, rhino);
  }

  return parsed;
}

/**
 * Process entries from a data tree path
 */
function processPathEntries(
  entries: DataItem[],
  typeFilter: OutputType | OutputType[] | undefined,
  parseValues: boolean,
  rhino?: any,
): any {
  const filteredEntries = entries.filter((item) => matchesTypeFilter(item.type, typeFilter));

  if (filteredEntries.length === 0) return null;

  const extractedValues = filteredEntries
    .map((entry) => extractItemValue(entry, parseValues, rhino))
    .filter((value) => value !== null);

  if (extractedValues.length === 0) return null;

  return extractedValues.length === 1 ? extractedValues[0] : extractedValues;
}

/**
 * Process a single parameter from the response
 */
function processParameter(
  param: GrasshopperComputeResponse['values'][0],
  options: Required<Omit<GetValuesOptions, 'types' | 'stringOnly' | 'generateTypes'>> & {
    typeFilter?: OutputType | OutputType[];
  },
): { values: Record<string, any>; type?: string } | null {
  const { typeFilter, parseValues, rhino } = options;
  const pathValues: Record<string, any> = {};
  let firstType: string | undefined;

  for (const [path, entries] of Object.entries(param.InnerTree)) {
    if (!Array.isArray(entries)) continue;

    const processedValue = processPathEntries(entries, typeFilter, parseValues, rhino);

    if (processedValue !== null) {
      pathValues[path] = processedValue;

      // Track first non-null type
      if (!firstType && entries.length > 0) {
        firstType = entries[0].type;
      }
    }
  }

  if (Object.keys(pathValues).length === 0) return null;

  // Flatten if only one path
  const finalValue =
    Object.keys(pathValues).length === 1 ? Object.values(pathValues)[0] : pathValues;

  return { values: finalValue, type: firstType };
}

// ============================================================================
// TYPE GENERATION
// ============================================================================

/**
 * Extract unique Rhino type names for imports
 */
function extractRhinoTypes(schema: Record<string, string>): Set<string> {
  const rhinoTypes = new Set<string>();
  const excludedTypes = [
    'Record<string, any>',
    'string',
    'number',
    'boolean',
    'unknown',
    'FileData',
  ];

  Object.values(schema).forEach((type) => {
    const baseType = type.replace(/\[\]$/, '');
    if (!excludedTypes.includes(baseType)) {
      rhinoTypes.add(baseType);
    }
  });

  return rhinoTypes;
}

/**
 * Generate TypeScript type definitions from schema
 */
function generateTypeInfo(result: ParsedContext, paramTypes: Map<string, string>): TypeInfo {
  // Build schema
  const schema: Record<string, string> = {};
  Object.entries(result).forEach(([key, value]) => {
    const rhinoType = paramTypes.get(key);
    schema[key] = inferType(value, rhinoType);
  });

  // Generate imports
  const rhinoTypes = extractRhinoTypes(schema);
  const importStatement =
    rhinoTypes.size > 0
      ? `import { ${Array.from(rhinoTypes).sort().join(', ')} } from 'rhino3dm';\n\n`
      : '';

  // Build interface
  const interfaceLines = ['export interface GrasshopperOutput {'];
  Object.entries(schema).forEach(([key, type]) => {
    interfaceLines.push(`  ${key}: ${type};`);
  });
  interfaceLines.push('}');

  // Build type alias
  const typeAliasLines = ['export type GrasshopperOutput = {'];
  Object.entries(schema).forEach(([key, type]) => {
    typeAliasLines.push(`  ${key}: ${type};`);
  });
  typeAliasLines.push('};');

  return {
    interface: interfaceLines.join('\n'),
    fullType: `${importStatement}${typeAliasLines.join('\n')}`,
  };
}

// ============================================================================
// MAIN PUBLIC API
// ============================================================================

/**
 * Extract and parse values from Grasshopper compute response with unified options.
 *
 * This is the recommended way to extract data from compute responses. It replaces
 * the older `getContextPrintData()` and `getAllValues()` methods with a single,
 * more flexible API.
 *
 * @param response - The GrasshopperComputeResponse from the server
 * @param options - Configuration options for extraction and parsing
 * @returns Parsed values and optional type information
 *
 * @example
 * ```typescript
 * // Get all values
 * const { values } = getValues(response);
 *
 * // Get string values only
 * const { values } = getValues(response, { stringOnly: true });
 *
 * // Get all values with TypeScript types
 * const { values, types } = getValues(response, { generateTypes: true });
 * console.log(types.interface); // "interface Output { ... }"
 *
 * // Filter specific types
 * const { values } = getValues(response, {
 *   types: ['System.String', 'System.Int32']
 * });
 * ```
 */
export function getValues<T = ParsedContext>(
  response: GrasshopperComputeResponse,
  options: GetValuesOptions = {},
): GetValuesResult<T> {
  const {
    types: typeFilter,
    stringOnly = false,
    parseValues = true,
    toCamelCase: useCamelCase = true,
    generateTypes = false,
    rhino,
  } = options;

  const actualTypeFilter = stringOnly ? SYSTEM_STRING : typeFilter;
  const result: ParsedContext = {};
  const paramTypes: Map<string, string> = new Map();

  // Process each parameter
  response.values.forEach((param) => {
    const paramName = param.ParamName || 'Unnamed Parameter';
    const key = useCamelCase ? toCamelCase(paramName, { preserveSpaces: false }) : paramName;

    const processed = processParameter(param, {
      typeFilter: actualTypeFilter,
      parseValues,
      toCamelCase: useCamelCase,
      rhino,
    });

    if (processed) {
      result[key] = processed.values;
      if (processed.type) {
        paramTypes.set(key, processed.type);
      }
    }
  });

  // Generate types if requested
  if (generateTypes) {
    return {
      values: result as T,
      types: generateTypeInfo(result, paramTypes),
    };
  }

  return { values: result as T };
}

/**
 * Extracts FileData items from the response
 *
 * @public Use this to extract files generated by the compute operation.
 */
export function extractFileData(response: GrasshopperComputeResponse): FileData[] {
  const fileData: FileData[] = [];

  response.values.forEach((param) => {
    for (const [, values] of Object.entries(param.InnerTree)) {
      if (!Array.isArray(values)) continue;

      values.forEach((item) => {
        const itemTypeEnding = item.type.split('.').pop();

        if (itemTypeEnding === FILE_DATA_TYPE) {
          try {
            const parsed = parseJsonSafe(item.data);
            if (parsed?.FileName && parsed?.FileType && parsed?.Data) {
              fileData.push(parsed as FileData);
            }
          } catch (error) {
            console.warn('Failed to parse FileData:', error);
          }
        }
      });
    }
  });

  return fileData;
}

/**
 * Gets all items from a specific parameter by name
 */
export function getParameter(
  response: GrasshopperComputeResponse,
  paramName: string,
  parseJson: boolean = true,
): DataItem[] | undefined {
  const param = response.values.find((p) => p.ParamName === paramName);
  if (!param) return undefined;

  const items: DataItem[] = [];

  for (const [, values] of Object.entries(param.InnerTree)) {
    if (!Array.isArray(values)) continue;

    values.forEach((item) => {
      items.push({
        ...item,
        data: parseJson ? parseJsonSafe(item.data) : item.data,
      });
    });
  }

  return items.length > 0 ? items : undefined;
}

/**
 * Gets all parameter names from the response
 */
export function getParameterNames(response: GrasshopperComputeResponse): string[] {
  return response.values.map((param) => param.ParamName);
}
