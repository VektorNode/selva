/**
 * Grasshopper types - re-exported from organized subdirectories
 * Provides backward compatibility with the original monolithic types.ts
 */

// Data tree types
export type { DataTreePath, DataItem, DataTreeDefault, InnerTreeData, InnerTree, Values, ProcessedDataItem } from './trees';

// Parameter types
export type {
  OutputType,
  DefaultValue,
  BaseInputType,
  NumericInputType,
  TextInputType,
  BooleanInputType,
  GeometryInputType,
  ValueListInputType,
  InputParam,
} from './parameters';

// Grouping types
export type { GroupInputs, NestedGroupNode, NestedGroupInputs } from './grouping';

// Schema types
export type {
  GrasshopperBaseSchema,
  GrasshopperDefinitionSource,
  GrasshopperComputeConfig,
  IoResponseSchema,
  GrasshopperRequestSchema,
  GrasshopperComputeResponse,
  InputParamSchema,
  OutputParamSchema
} from './schemas';

// Parsed types
export type { GrasshopperParsedIORaw, GrasshopperParsedIO } from './parsed';
