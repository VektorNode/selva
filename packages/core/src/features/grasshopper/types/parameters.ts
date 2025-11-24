/**
 * Input and output parameter types
 */

import type { DataTreeDefault } from './trees';

/**
 * Output types supported from Grasshopper/Rhino Compute
 */
export type OutputType =
  | 'System.String'
  | 'System.Double'
  | 'System.Int32'
  | 'System.Boolean'
  | 'Rhino.Geometry.Point3d'
  | 'Rhino.Geometry.Line'
  | 'Rhino.Geometry.Circle'
  | 'Rhino.Geometry.Arc'
  | 'Rhino.Geometry.NurbsCurve'
  | 'Rhino.Geometry.Brep'
  | 'Rhino.Geometry.Mesh'
  | 'Rhino.Geometry.Vector3d'
  | 'Rhino.Geometry.Plane'
  | 'Rhino.Geometry.Box'
  | string;

/**
 * Output parameter schema after conversion to camelCase
 *
 * Represents an output parameter after runtime conversion via camelcaseKeys().
 * Property names follow JavaScript conventions (camelCase).
 */
export interface OutputParamSchema {
  name: string;
  nickname: string | null;
  paramType: string;
  id: string;
}

/**
 * Union type for all possible default value types
 */
export type DefaultValue<T> = T | T[] | DataTreeDefault<T> | undefined | null;

/**
 * Base properties common to all processed input types
 */
export interface BaseInputType {
  description: string;
  name: string;
  nickname: string | null;
  treeAccess: boolean;
  groupName: string;
  id: string;
}

/**
 * Numeric input type (Number or Integer)
 */
export interface NumericInputType extends BaseInputType {
  paramType: 'Number' | 'Integer';
  minimum?: number | null;
  maximum?: number | null;
  atLeast?: number | null;
  atMost?: number | null;
  stepSize?: number | null;
  default: DefaultValue<number>;
}

/**
 * Text input type
 */
export interface TextInputType extends BaseInputType {
  paramType: 'Text';
  default: DefaultValue<string>;
}

/**
 * Boolean input type
 */
export interface BooleanInputType extends BaseInputType {
  paramType: 'Boolean';
  default: DefaultValue<boolean>;
}

/**
 * Geometry input type (generic geometry)
 */
export interface GeometryInputType extends BaseInputType {
  paramType: 'Geometry';
  default: DefaultValue<object | string>;
}

/**
 * ValueList input type (dropdown/select)
 */
export interface ValueListInputType extends BaseInputType {
  paramType: 'ValueList';
  values: Record<string, string>;
  default?: string;
}

/**
 * Discriminated union of all input parameter types
 */
export type InputParam =
  | NumericInputType
  | BooleanInputType
  | TextInputType
  | ValueListInputType
  | GeometryInputType;

/**
 * Input parameter schema after conversion to camelCase
 *
 * This represents an input parameter after runtime conversion via camelcaseKeys().
 * All property names follow JavaScript conventions (camelCase).
 */
export interface InputParamSchema {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  name: string;
  nickname: string | null;
  description: string;
  paramType: string;
  treeAccess: boolean;
  minimum: number | null;
  maximum: number | null;
  atLeast: number;
  atMost: number;
  stepSize?: number;
  default: any;
  /**
   * Key-value pairs for dropdown options
   */
  values?: Record<string, string>;
  groupName?: string | null;
}
