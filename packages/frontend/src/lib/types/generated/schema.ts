/* eslint-disable */
/**
 * This file was automatically generated from schemas/ui-schema.json.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,
 * and run `npm run generate:ts` in the schemas directory to regenerate this file.
 */

export type GrasshopperParamType = 'number' | 'integer' | 'boolean' | 'text' | 'valueList' | 'generic';
export type LayoutItem =
  | InputNumberLayoutItem
  | InputTextLayoutItem
  | InputDropdownLayoutItem
  | InputCheckboxLayoutItem
  | OutputTextLayoutItem
  | OutputNumberLayoutItem
  | OutputFileLayoutItem;

/**
 * Schema definitions for Selva UI configuration
 */
export interface SelvaUISchema {
  [k: string]: unknown | undefined;
}
export interface InputParamSchema {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  nickname: string;
  paramType: GrasshopperParamType;
  description?: string;
  default?: unknown;
}
export interface OutputParamSchema {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  nickname: string;
  paramType: GrasshopperParamType;
  description?: string;
}
export interface AvailableInput {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  name: string;
  nickname: string;
  description: string;
  type: GrasshopperParamType;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  stepSize?: number;
  atLeast?: number;
  atMost?: number;
  treeAccess?: boolean;
  /**
   * Key-value pairs for dropdown/selection options
   */
  options?: {
    [k: string]: string | undefined;
  };
  [k: string]: unknown | undefined;
}
export interface AvailableOutput {
  /**
   * Grasshopper component instance GUID
   */
  id: string;
  nickname: string;
  description?: string;
  /**
   * Output display type in UI: 'text' for text/console output, 'number' for numeric output, 'file' for downloadable files
   */
  type: 'text' | 'number' | 'file';
}
export interface AvailableParameters {
  sessionId: string;
  timestamp: string;
  /**
   * List of input parameters available for UI building
   */
  inputs: AvailableInput[];
  /**
   * List of output components available for UI building
   */
  outputs: AvailableOutput[];
  [k: string]: unknown | undefined;
}
export interface NumberWidgetConfig {
  minimum?: number;
  maximum?: number;
  stepSize?: number;
  placeholder?: string;
  renderAsSlider?: boolean;
}
export interface TextWidgetConfig {
  placeholder?: string;
  required?: boolean;
}
export interface DropdownWidgetConfig {
  /**
   * Key-value pairs for dropdown options
   */
  options: {
    [k: string]: string | undefined;
  };
  required?: boolean;
}
export interface CheckboxWidgetConfig {}
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
export interface OutputFileLayoutItem {
  id: string;
  /**
   * References the ContextBake component InstanceGuid for file download
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
  type: 'output';
  widgetType: 'file';
  config?: {
    buttonLabel?: string;
    /**
     * File format hint (e.g., 'zip', '3dm')
     */
    fileFormat?: string;
  };
  [k: string]: unknown | undefined;
}
export interface GroupConfig {
  id: string;
  label: string;
  description?: string;
  order?: number;
  collapsed?: boolean;
  columns?: number;
  items: LayoutItem[];
}
export interface TabConfig {
  id: string;
  label: string;
  icon?: string;
  order?: number;
  groups: GroupConfig[];
  /**
   * Horizontal region where this tab should be positioned in multi-column layouts
   */
  position?: 'left' | 'center' | 'right';
}
export interface LayoutConfig {
  type?: 'tabbed' | 'flat';
  gap?: number;
  tabs?: TabConfig[];
}
export interface SessionState {
  sessionId: string;
  active: boolean;
  lastUpdate: string;
  mode: 'builder' | 'preview';
  [k: string]: unknown | undefined;
}
export interface RuntimeValues {
  timestamp: string;
  values: {
    [k: string]: unknown | undefined;
  };
  [k: string]: unknown | undefined;
}
export interface ViewerOptions {
  /**
   * If true, display mesh data is sent to the web preview for local rendering
   */
  enableLocal?: boolean;
  /**
   * If true, enables remote rendering via Rhino Compute
   */
  enableRemote?: boolean;
  /**
   * Background color for the 3D viewer as hex string (e.g., '#ffffff')
   */
  backgroundColor?: string;
}
export interface UISchema {
  id: string;
  name: string;
  description?: string;
  /**
   * Semantic version of the schema format (MAJOR.MINOR.PATCH)
   */
  schemaVersion?: string;
  /**
   * Minimum plugin version required to load this schema
   */
  minPluginVersion?: string;
  created?: string;
  /**
   * Last modification timestamp
   */
  lastModified?: string;
  viewerOptions?: ViewerOptions1;
  /**
   * If true, changes trigger immediate solving. If false, user must press Calculate button.
   */
  instanceSolve?: boolean;
  inputs: InputParamSchema[];
  /**
   * All output components (print, bake, file download)
   */
  outputs: AvailableOutput[];
  layout: LayoutConfig;
}
/**
 * Configuration for the 3D viewer
 */
export interface ViewerOptions1 {
  /**
   * If true, display mesh data is sent to the web preview for local rendering
   */
  enableLocal?: boolean;
  /**
   * If true, enables remote rendering via Rhino Compute
   */
  enableRemote?: boolean;
  /**
   * Background color for the 3D viewer as hex string (e.g., '#ffffff')
   */
  backgroundColor?: string;
}


// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem {
  return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem {
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
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem;
export type SupportedTypes = string | number | boolean;
