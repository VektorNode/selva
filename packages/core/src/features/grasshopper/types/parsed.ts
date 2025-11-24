/**
 * Parsed data structures for processed Grasshopper input/output
 */

import type { InputParam, InputParamSchema, OutputParamSchema } from './parameters';

/**
 * Parsed input/output structure with raw schemas
 */
export interface GrasshopperParsedIORaw {
  inputs: InputParamSchema[];
  outputs: OutputParamSchema[];
}

/**
 * Parsed input/output structure with processed types
 */
export interface GrasshopperParsedIO {
  inputs: InputParam[];
  outputs: OutputParamSchema[];
}
