/* eslint-disable */
/**
 * This file was automatically generated from schemas/ui-schema.json.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,
 * and run `npm run generate:ts` in the schemas directory to regenerate this file.
 */

/**
 * Grasshopper parameter types
 *
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "GrasshopperParamType".
 */
export type GrasshopperParamType = 'Number' | 'Integer' | 'Boolean' | 'Text' | 'ValueList' | 'Generic';
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "LayoutItem".
 */
export type LayoutItem =
  | InputNumberLayoutItem
  | InputTextLayoutItem
  | InputDropdownLayoutItem
  | InputCheckboxLayoutItem
  | OutputTextLayoutItem
  | OutputNumberLayoutItem;

/**
 * Schema definitions for ComputeBuilder UI configuration
 */
export interface ComputeBuilderUISchema {
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "InputParamSchema".
 */
export interface InputParamSchema {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  name: string;
  nickname: string;
  paramType: GrasshopperParamType;
  description?: string;
  atLeast?: number;
  atMost?: number;
  treeAccess?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  stepSize?: number;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "OutputParamSchema".
 */
export interface OutputParamSchema {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  name: string;
  nickname: string;
  paramType: GrasshopperParamType;
  description?: string;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "NumberWidgetConfig".
 */
export interface NumberWidgetConfig {
  minimum?: number;
  maximum?: number;
  step?: number;
  placeholder?: string;
  renderAsSlider?: boolean;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "TextWidgetConfig".
 */
export interface TextWidgetConfig {
  placeholder?: string;
  required?: boolean;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "DropdownWidgetConfig".
 */
export interface DropdownWidgetConfig {
  /**
   * Key-value pairs for dropdown options
   */
  options: {
    [k: string]: string | undefined;
  };
  required?: boolean;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "CheckboxWidgetConfig".
 */
export interface CheckboxWidgetConfig {}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "InputNumberLayoutItem".
 */
export interface InputNumberLayoutItem {
  id: string;
  /**
   * References the Grasshopper component InstanceGuid
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'input';
  widgetType: 'number';
  config: NumberWidgetConfig;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "InputTextLayoutItem".
 */
export interface InputTextLayoutItem {
  id: string;
  /**
   * References the Grasshopper component InstanceGuid
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'input';
  widgetType: 'text';
  config: TextWidgetConfig;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "InputDropdownLayoutItem".
 */
export interface InputDropdownLayoutItem {
  id: string;
  /**
   * References the Grasshopper component InstanceGuid
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'input';
  widgetType: 'dropdown';
  config: DropdownWidgetConfig;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "InputCheckboxLayoutItem".
 */
export interface InputCheckboxLayoutItem {
  id: string;
  /**
   * References the Grasshopper component InstanceGuid
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'input';
  widgetType: 'checkbox';
  config?: CheckboxWidgetConfig;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "OutputTextLayoutItem".
 */
export interface OutputTextLayoutItem {
  id: string;
  /**
   * References the Grasshopper component InstanceGuid
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'output';
  widgetType: 'text';
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "OutputNumberLayoutItem".
 */
export interface OutputNumberLayoutItem {
  id: string;
  /**
   * References the Grasshopper component InstanceGuid
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'output';
  widgetType: 'number';
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "GroupConfig".
 */
export interface GroupConfig {
  id: string;
  label: string;
  description?: string;
  order: number;
  collapsed: boolean;
  columns: number;
  items: LayoutItem[];
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "TabConfig".
 */
export interface TabConfig {
  id: string;
  label: string;
  icon?: string;
  order: number;
  groups: GroupConfig[];
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "LayoutConfig".
 */
export interface LayoutConfig {
  type: 'tabbed' | 'flat';
  gap: number;
  tabs?: TabConfig[];
  items?: LayoutItem[];
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "UISchema".
 */
export interface UISchema {
  id: string;
  name: string;
  description: string;
  version: string;
  /**
   * Semantic version of the schema format (MAJOR.MINOR.PATCH)
   */
  schemaVersion?: string;
  /**
   * Minimum plugin version required to load this schema
   */
  minPluginVersion?: string;
  created: string;
  /**
   * Last modification timestamp
   */
  lastModified?: string;
  inputs: InputParamSchema[];
  outputs: OutputParamSchema[];
  layout: LayoutConfig;
  enable3dViewer: boolean;
  /**
   * If true, changes trigger immediate solving. If false, user must press Calculate button.
   */
  instanceSolve?: boolean;
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "RuntimeValues".
 */
export interface RuntimeValues {
  timestamp: string;
  values: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "SessionState".
 */
export interface SessionState {
  sessionId: string;
  active: boolean;
  lastUpdate: string;
  mode: 'builder' | 'preview';
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "AvailableParameter".
 */
export interface AvailableParameter {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  name: string;
  nickname: string;
  description: string;
  category: 'input' | 'output';
  paramType: GrasshopperParamType;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  stepSize?: number;
  atLeast?: number;
  atMost?: number;
  treeAccess?: boolean;
  /**
   * Key-value pairs for dropdown options
   */
  options?: {
    [k: string]: string | undefined;
  };
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `ComputeBuilderUISchema`'s JSON-Schema
 * via the `definition` "AvailableParameters".
 */
export interface AvailableParameters {
  sessionId: string;
  timestamp: string;
  parameters: AvailableParameter[];
  [k: string]: unknown | undefined;
}


// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem {
  return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputTextLayoutItem | OutputNumberLayoutItem {
  return item.type === 'output';
}

export function isNumberWidget(item: LayoutItem): item is InputNumberLayoutItem {
  return item.type === 'input' && item.widgetType === 'number';
}

export function isTextWidget(item: LayoutItem): item is InputTextLayoutItem {
  return item.type === 'input' && item.widgetType === 'text';
}

export function isDropdownWidget(item: LayoutItem): item is InputDropdownLayoutItem {
  return item.type === 'input' && item.widgetType === 'dropdown';
}

export function isCheckboxWidget(item: LayoutItem): item is InputCheckboxLayoutItem {
  return item.type === 'input' && item.widgetType === 'checkbox';
}

// Helper type aliases
export type InputLayoutItem = InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem;
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem;
export type SupportedTypes = string | number | boolean;
