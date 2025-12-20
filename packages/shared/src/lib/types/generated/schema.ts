/* eslint-disable */
/**
 * This file was automatically generated from schemas/ui-schema.json.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,
 * and run `npm run generate:ts` in the schemas directory to regenerate this file.
 */

export type GrasshopperParamType = 'number' | 'integer' | 'boolean' | 'text' | 'valueList' | 'file' | 'generic';
export type InputNumberLayoutItem = LayoutItemBase & {
  type: 'input';
  widgetType: 'number';
  config?: NumberWidgetConfig;
  [k: string]: unknown | undefined;
};
export type InputTextLayoutItem = LayoutItemBase & {
  type: 'input';
  widgetType: 'text';
  config?: TextWidgetConfig;
  [k: string]: unknown | undefined;
};
export type InputDropdownLayoutItem = LayoutItemBase & {
  type: 'input';
  widgetType: 'dropdown';
  config: DropdownWidgetConfig;
  [k: string]: unknown | undefined;
};
export type InputCheckboxLayoutItem = LayoutItemBase & {
  type: 'input';
  widgetType: 'checkbox';
  config?: CheckboxWidgetConfig;
  [k: string]: unknown | undefined;
};
export type InputFileLayoutItem = LayoutItemBase & {
  type: 'input';
  widgetType: 'file';
  config?: FileInputWidgetConfig;
  [k: string]: unknown | undefined;
};
export type OutputTextLayoutItem = LayoutItemBase & {
  type: 'output';
  widgetType: 'text';
  [k: string]: unknown | undefined;
};
export type OutputNumberLayoutItem = LayoutItemBase & {
  type: 'output';
  widgetType: 'number';
  [k: string]: unknown | undefined;
};
export type OutputFileLayoutItem = LayoutItemBase & {
  type: 'output';
  widgetType: 'file';
  config?: FileWidgetConfig;
  [k: string]: unknown | undefined;
};
export type LayoutItem =
  | InputNumberLayoutItem
  | InputTextLayoutItem
  | InputDropdownLayoutItem
  | InputCheckboxLayoutItem
  | InputFileLayoutItem
  | OutputTextLayoutItem
  | OutputNumberLayoutItem
  | OutputFileLayoutItem;
export type LayoutConfig = TabbedLayoutConfig | FlatLayoutConfig;

/**
 * Schema definitions for Selva UI configuration
 */
export interface SelvaUISchema {
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
export interface FileWidgetConfig {
  buttonLabel?: string;
  /**
   * File format hint (e.g., 'zip', '3dm')
   */
  fileFormat?: string;
}
export interface FileInputWidgetConfig {
  /**
   * List of accepted file extensions (e.g., ['.3dm', '.step'])
   */
  acceptedFormats?: string[];
  /**
   * Default input mode for file input (upload or url)
   */
  defaultInputMode?: 'upload' | 'url';
}
export interface LayoutItemBase {
  /**
   * Unique identifier for this layout item in the UI tree (not the parameter ID)
   */
  id: string;
  /**
   * References the Grasshopper component InstanceGuid (Data Source)
   */
  paramId: string;
  displayName?: string;
  description?: string;
  order?: number;
  span?: number;
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
export interface TabbedLayoutConfig {
  type: 'tabbed';
  gap?: number;
  tabs: TabConfig[];
}
export interface FlatLayoutConfig {
  type: 'flat';
  gap?: number;
  groups: GroupConfig[];
}
export interface DiscoveredInput {
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
export interface DiscoveredOutput {
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
export interface DiscoveredParameters {
  sessionId: string;
  timestamp: string;
  /**
   * List of input parameters available for UI building
   */
  inputs: DiscoveredInput[];
  /**
   * List of output components available for UI building
   */
  outputs: DiscoveredOutput[];
  [k: string]: unknown | undefined;
}
export interface SchemaInput {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  nickname: string;
  paramType: GrasshopperParamType;
  description?: string;
  default?: unknown;
}
export interface SchemaOutput {
  /**
   * Grasshopper parameter instance GUID
   */
  id: string;
  nickname: string;
  description?: string;
  /**
   * Output display type
   */
  type: 'text' | 'number' | 'file';
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
   * Grasshopper document file name (e.g., 'myfile.gh')
   */
  projectFileName?: string;
  /**
   * Grasshopper document unique identifier (GUID)
   */
  documentId?: string;
  /**
   * Version of Selva plugin that created/last modified this schema
   */
  pluginVersion?: string;
  /**
   * User-defined tags for organizing schemas (e.g., ['architecture', 'facade'])
   */
  tags?: string[];
  /**
   * User or organization who created the schema
   */
  author?: string;
  /**
   * Organization/company name
   */
  organization?: string;
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
  inputs: SchemaInput[];
  /**
   * All output components (print, bake, file download)
   */
  outputs: SchemaOutput[];
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
export interface ValidationIssueMessage {
  paramId: string;
  /**
   * warning = can still load, error = cannot load
   */
  severity: 'warning' | 'error';
  message: string;
  details?: {
    expected?: string;
    actual?: string;
    [k: string]: unknown | undefined;
  };
}


// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem | InputFileLayoutItem {
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

export function isFileWidget(item: LayoutItem): item is InputFileLayoutItem {
  return item.type === 'input' && item.widgetType === 'file';
}

// Helper type aliases
export type InputLayoutItem = InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem | InputFileLayoutItem;
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem;
export type SupportedTypes = string | number | boolean;
