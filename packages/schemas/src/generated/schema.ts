/* eslint-disable */
/**
 * This file was automatically generated from schemas/ui-schema.json.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,
 * and run `npm run generate:ts` in the schemas directory to regenerate this file.
 */

export type GrasshopperParamType =
	| 'number'
	| 'integer'
	| 'boolean'
	| 'text'
	| 'valueList'
	| 'dynamicValueList'
	| 'file'
	| 'color'
	| 'generic';
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
export type InputDynamicValueListLayoutItem = LayoutItemBase & {
	type: 'input';
	widgetType: 'dynamicValueList';
	config?: DynamicValueListWidgetConfig;
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
export type InputColorLayoutItem = LayoutItemBase & {
	type: 'input';
	widgetType: 'color';
	config?: ColorWidgetConfig;
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
export type OutputChartLayoutItem = LayoutItemBase & {
	type: 'output';
	widgetType: 'chart';
	config?: ChartWidgetConfig;
	[k: string]: unknown | undefined;
};
export type OutputImageLayoutItem = LayoutItemBase & {
	type: 'output';
	widgetType: 'image';
	config?: ImageWidgetConfig;
	[k: string]: unknown | undefined;
};
export type OutputDynamicValueListLayoutItem = LayoutItemBase & {
	type: 'output';
	widgetType: 'dynamicValueList';
	config: DynamicValueListOutputConfig;
	[k: string]: unknown | undefined;
};
export type LayoutItem =
	| InputNumberLayoutItem
	| InputTextLayoutItem
	| InputDropdownLayoutItem
	| InputDynamicValueListLayoutItem
	| InputCheckboxLayoutItem
	| InputFileLayoutItem
	| InputColorLayoutItem
	| OutputTextLayoutItem
	| OutputNumberLayoutItem
	| OutputFileLayoutItem
	| OutputChartLayoutItem
	| OutputImageLayoutItem
	| OutputDynamicValueListLayoutItem
	| LineBreakLayoutItem;
export type LayoutConfig = TabbedLayoutConfig | FlatLayoutConfig;
export type GrasshopperInputStructure = 'item' | 'list' | 'tree';

/**
 * Schema definitions for Selva UI configuration
 */
export interface SelvaUISchema {
	[k: string]: unknown | undefined;
}
export interface VisibilityRule {
	/**
	 * Parameter ID to watch for changes
	 */
	paramId: string;
	/**
	 * Comparison operator. 'contains', 'containsAny', 'isEmpty', 'isNotEmpty' apply to array-valued params (e.g., checklist value lists).
	 */
	operator:
		| 'equals'
		| 'notEquals'
		| 'greaterThan'
		| 'lessThan'
		| 'greaterThanOrEqual'
		| 'lessThanOrEqual'
		| 'in'
		| 'notIn'
		| 'between'
		| 'matches'
		| 'contains'
		| 'containsAny'
		| 'isEmpty'
		| 'isNotEmpty';
	/**
	 * Value to compare against (used for equals, notEquals, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual)
	 */
	value?: {
		[k: string]: unknown | undefined;
	};
	/**
	 * Array of values (used for 'in', 'notIn' operators, or [min, max] for 'between')
	 */
	values?: unknown[];
}
export interface VisibilityCondition {
	/**
	 * Evaluation mode: 'all' = AND (all rules must pass), 'any' = OR (at least one rule must pass)
	 */
	mode?: 'all' | 'any';
	/**
	 * List of rules to evaluate
	 *
	 * @minItems 1
	 */
	rules: [VisibilityRule, ...VisibilityRule[]];
	/**
	 * Action to apply when condition is met: 'show' makes visible and enabled, 'hide' removes from view, 'disable' makes visible but greyed out and non-interactive
	 */
	action?: 'show' | 'hide' | 'disable';
	/**
	 * Default value to set for the parameter when condition is met. The value should be compatible with the parameter type (number, string, boolean, etc.)
	 */
	defaultValue?: {
		[k: string]: unknown | undefined;
	};
}
export interface GroupVisibilityCondition {
	/**
	 * Evaluation mode: 'all' = AND (all rules must pass), 'any' = OR (at least one rule must pass)
	 */
	mode?: 'all' | 'any';
	/**
	 * List of rules to evaluate
	 *
	 * @minItems 1
	 */
	rules: [VisibilityRule, ...VisibilityRule[]];
	/**
	 * Action to apply when condition is met: 'show' makes group visible, 'hide' removes group from view
	 */
	action?: 'show' | 'hide';
}
export interface NumberWidgetConfig {
	minimum?: number;
	maximum?: number;
	stepSize?: number;
	placeholder?: string;
	renderAsSlider?: boolean;
	/**
	 * Hide the min/max range hint shown next to the label / under the input
	 */
	hideRange?: boolean;
}
export interface TextWidgetConfig {
	placeholder?: string;
	required?: boolean;
	/**
	 * Maximum character length for text input
	 */
	maxLength?: number;
	/**
	 * Regex pattern for validation (e.g., email, phone)
	 */
	pattern?: string;
	/**
	 * Custom error message shown when pattern validation fails
	 */
	customErrorMessage?: string;
}
export interface DropdownWidgetConfig {
	/**
	 * Key-value pairs for dropdown options
	 */
	options: {
		[k: string]: string | undefined;
	};
	required?: boolean;
	/**
	 * How to render the value list. 'dropdown' = single-select dropdown (value: string). 'checklist' = multi-select checkboxes (value: string[]); requires list access on the connected Grasshopper parameter.
	 */
	displayAs?: 'dropdown' | 'checklist';
}
export interface DynamicValueListWidgetConfig {
	/**
	 * Author-provided seed list (name -> value). Shown until computed options replace it. Empty/absent means the input is empty until the first solve produces options.
	 */
	defaultOptions?: {
		[k: string]: string | undefined;
	};
	/**
	 * What to render when there are no options yet (no defaultOptions and no computed options): 'hide' removes the field from view, 'show-empty' shows a disabled 'no options yet' control.
	 */
	emptyBehavior?: 'hide' | 'show-empty';
	/**
	 * How to render the value list. 'dropdown' = single-select (value: string). 'checklist' = multi-select (value: string[]).
	 */
	displayAs?: 'dropdown' | 'checklist';
}
export interface DynamicValueListOutputConfig {
	/**
	 * The Grasshopper instance GUID (paramId) of the DynamicValueList input that this output's computed options populate.
	 */
	targetInputId: string;
}
export interface CheckboxWidgetConfig {}
export interface FileWidgetConfig {
	buttonLabel?: string;
	/**
	 * File format hint (e.g., '3dm') for setting download extension
	 */
	fileFormat?: string;
}
export interface FileInputWidgetConfig {
	/**
	 * List of accepted file extensions (e.g., ['.3dm', '.step'])
	 */
	acceptedFormats?: string[];
	/**
	 * Which mode is active by default when both are allowed
	 */
	defaultInputMode?: 'upload' | 'url';
	/**
	 * Which input modes the end user can choose from. If omitted, both are allowed.
	 */
	allowedInputModes?: ('upload' | 'url')[];
}
export interface ColorWidgetConfig {}
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
	/**
	 * Base visibility (static). If false, item is always hidden regardless of conditions.
	 */
	visible?: boolean;
	visibilityCondition?: VisibilityCondition;
	source?: InputSource;
	[k: string]: unknown | undefined;
}
export interface InputSource {
	/**
	 * Who supplies the input's value. 'user' = the person fills it in, in the form. 'client' = supplied by an app in the browser before the form runs, not by the person (e.g. a measurement/producer tool). 'server' = looked up on the server from your data when the definition runs; never shown in the form.
	 */
	kind: 'user' | 'client' | 'server';
	/**
	 * The opaque address of the value, interpreted by the host app per 'kind': for 'client' it names WHICH producer app fills the input (e.g. 'line-app', 'file-upload') so the host can pre-route to it; for 'server' it names WHAT to fetch (e.g. 'capture.geometry') for the host's resolver. An open string — its meaning is defined by the host, not by Selva. Ignored for kind='user'.
	 */
	key?: string;
	/**
	 * How a client-sourced input appears in the form (only meaningful when kind='client'). Omitted = hidden (prefilled silently). 'slot' = Selva reserves the input's cell and renders a host-provided element in its place; Selva renders nothing itself and never interprets the element's meaning.
	 */
	client?: {
		/**
		 * 'hidden' = no UI; the value is prefilled by the producer app and the input does not appear. 'slot' = the host app renders a custom element (e.g. an 'Edit JSON' button) in this input's place.
		 */
		presentation?: 'hidden' | 'slot';
		/**
		 * Author-set text passed through to the host's slot snippet untouched. Selva does not render or interpret it (e.g. 'Edit JSON').
		 */
		slotLabel?: string;
	};
}
export interface ChartWidgetConfig {}
export interface ImageWidgetConfig {
	/**
	 * Show a download button on the image viewer
	 */
	allowDownload?: boolean;
	/**
	 * Show a fullscreen toggle button on the image viewer
	 */
	allowFullscreen?: boolean;
	/**
	 * Optional background color shown behind the image (hex string, e.g. '#ffffff')
	 */
	backgroundColor?: string;
}
export interface LineBreakLayoutItem {
	/**
	 * Unique identifier for this layout item in the UI tree
	 */
	id: string;
	type: 'linebreak';
}
export interface GroupConfig {
	id: string;
	label: string;
	description?: string;
	order?: number;
	collapsed?: boolean;
	columns?: number;
	items: LayoutItem[];
	visibilityCondition?: GroupVisibilityCondition;
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
	/**
	 * Nickname of the directly enclosing Grasshopper group, if any. Used by the builder to offer 'Add by GH group' bulk import.
	 */
	groupName?: string;
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
	 * Output display type in UI: 'text' for text output, 'number' for numeric output, 'file' for downloadable files, 'chart' for rendered charts (e.g. Plotly), 'dynamicValueList' for computed value-list options routed back into a dynamic value list input
	 */
	type: 'text' | 'number' | 'file' | 'chart' | 'dynamicValueList';
	/**
	 * For 'dynamicValueList' outputs: the instance GUID (paramId) of the DynamicValueList input that this output's computed options populate.
	 */
	targetInputId?: string;
	/**
	 * Nickname of the directly enclosing Grasshopper group, if any. Used by the builder to offer 'Add by GH group' bulk import.
	 */
	groupName?: string;
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
	/**
	 * Grasshopper data access mode: 'item' = Item Access, 'list' = List Access, 'tree' = Tree Access. Defaults to 'item'.
	 */
	inputStructure?: 'item' | 'list' | 'tree';
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
	type: 'text' | 'number' | 'file' | 'chart' | 'dynamicValueList';
	/**
	 * For 'dynamicValueList' outputs: the instance GUID (paramId) of the DynamicValueList input that this output's computed options populate.
	 */
	targetInputId?: string;
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
	 * Category for organizing schemas (e.g., 'architecture', 'structural', 'mechanical')
	 */
	category?: string;
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
// CONSTANTS (from schema)
// ============================================================================

export const ACCEPTED_FILE_FORMATS = [
	'.3dm',
	'.stp',
	'.step',
	'.fbx',
	'.obj',
	'.dxf',
	'.stl'
] as const;

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(
	item: LayoutItem
): item is
	| InputNumberLayoutItem
	| InputTextLayoutItem
	| InputDropdownLayoutItem
	| InputDynamicValueListLayoutItem
	| InputCheckboxLayoutItem
	| InputFileLayoutItem
	| InputColorLayoutItem {
	return item.type === 'input';
}

export function isOutputLayoutItem(
	item: LayoutItem
): item is
	| OutputTextLayoutItem
	| OutputNumberLayoutItem
	| OutputFileLayoutItem
	| OutputChartLayoutItem
	| OutputImageLayoutItem
	| OutputDynamicValueListLayoutItem {
	return item.type === 'output';
}

export function isLineBreakLayoutItem(item: LayoutItem): item is LineBreakLayoutItem {
	return item.type === 'linebreak';
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

export function isDynamicValueListWidget(
	item: LayoutItem
): item is InputDynamicValueListLayoutItem {
	return item.type === 'input' && item.widgetType === 'dynamicValueList';
}

export function isCheckboxWidget(item: LayoutItem): item is InputCheckboxLayoutItem {
	return item.type === 'input' && item.widgetType === 'checkbox';
}

export function isFileWidget(item: LayoutItem): item is InputFileLayoutItem {
	return item.type === 'input' && item.widgetType === 'file';
}

export function isColorWidget(item: LayoutItem): item is InputColorLayoutItem {
	return item.type === 'input' && item.widgetType === 'color';
}

export function isImageWidget(item: LayoutItem): item is OutputImageLayoutItem {
	return item.type === 'output' && item.widgetType === 'image';
}

// Helper type aliases
export type InputLayoutItem =
	| InputNumberLayoutItem
	| InputTextLayoutItem
	| InputDropdownLayoutItem
	| InputDynamicValueListLayoutItem
	| InputCheckboxLayoutItem
	| InputFileLayoutItem
	| InputColorLayoutItem;
export type OutputLayoutItem =
	| OutputTextLayoutItem
	| OutputNumberLayoutItem
	| OutputFileLayoutItem
	| OutputChartLayoutItem
	| OutputImageLayoutItem
	| OutputDynamicValueListLayoutItem;
export type SupportedTypes = string | number | boolean | string[];
