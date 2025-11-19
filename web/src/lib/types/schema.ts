export interface UISchema {
	id: string;
	name: string;
	description: string;
	version: string;
	created: string;
	inputs: InputParamSchema[];
	outputs: OutputParamSchema[];
	layout: LayoutConfig;
	enable3dViewer: boolean;
}

// ============================================================================
// CORE PARAMETER SCHEMAS (Compute-compatible)
// ============================================================================

export type GrasshopperParamType =
	// Primitive types
	| "Number"
	| "Integer"
	| "Boolean"
	| "Text"
	// Fallback
	| "Generic";

export interface IoParamSchema {
	id: string; // Grasshopper parameter instance GUID - stable reference for mapping
	name: string;
	nickname: string;
	paramType: GrasshopperParamType;
}

export interface InputParamSchema extends IoParamSchema {
	description?: string;
	atLeast?: number;
	atMost?: number;
	treeAccess?: boolean;
	default?: any;
	minimum?: any;
	maximum?: any;
	stepSize?: number;
}

export interface OutputParamSchema extends IoParamSchema {
	description?: string;
}

// ============================================================================
// DISCRIMINATED WIDGET CONFIGS
// ============================================================================

/**
 * Slider widget configuration
 */
export interface SliderWidgetConfig {
	min: number;
	max: number;
	step?: number;
}

/**
 * Number input widget configuration
 */
export interface NumberWidgetConfig {
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
}

/**
 * Text input widget configuration
 */
export interface TextWidgetConfig {
	placeholder?: string;
	required?: boolean;
}

/**
 * Dropdown widget configuration
 */
export interface DropdownWidgetConfig {
	options: string[];
	required?: boolean;
}

/**
 * Checkbox widget configuration
 */
export interface CheckboxWidgetConfig {
	// Minimal config - mostly just state
}

/**
 * Text display widget configuration
 */
export interface TextDisplayConfig {
}

/**
 * Number display widget configuration
 */
export interface NumberDisplayConfig {
}


// ============================================================================
// DISCRIMINATED LAYOUT ITEMS
// ============================================================================

/**
 * Base layout item properties
 */
interface BaseLayoutItem {
	id: string;
	paramId: string;
	displayName?: string;
	description?: string;
	order?: number;
	span?: number;
}

/**
 * Input layout items with discriminated widget types
 */
export type InputLayoutItem =
	| {
		type: 'input';
		widgetType: 'slider';
		config: SliderWidgetConfig;
	} & BaseLayoutItem
	| {
		type: 'input';
		widgetType: 'number';
		config: NumberWidgetConfig;
	} & BaseLayoutItem
	| {
		type: 'input';
		widgetType: 'text';
		config: TextWidgetConfig;
	} & BaseLayoutItem
	| {
		type: 'input';
		widgetType: 'dropdown';
		config: DropdownWidgetConfig;
	} & BaseLayoutItem
	| {
		type: 'input';
		widgetType: 'checkbox';
		config: CheckboxWidgetConfig;
	} & BaseLayoutItem;

/**
 * Output layout items with discriminated widget types
 */
export type OutputLayoutItem =
	| {
		type: 'output';
		widgetType: 'text';
		config: TextDisplayConfig;
	} & BaseLayoutItem
	| {
		type: 'output';
		widgetType: 'number';
		config: NumberDisplayConfig;
	} & BaseLayoutItem;

/**
 * Union of all layout item types
 */
export type LayoutItem = InputLayoutItem | OutputLayoutItem;

// ============================================================================
// LAYOUT CONFIGURATION
// ============================================================================

export interface LayoutConfig {
	type: 'tabbed' | 'flat';
	gap: number;
	tabs?: TabConfig[];
	items?: LayoutItem[];
}

export interface TabConfig {
	id: string;
	label: string;
	icon?: string;
	order: number;
	groups: GroupConfig[];
}

export interface GroupConfig {
	id: string;
	label: string;
	description?: string;
	order: number;
	collapsed: boolean;
	columns: number;
	items: LayoutItem[];
}

// ============================================================================
// RUNTIME DATA
// ============================================================================

export interface RuntimeValues {
	timestamp: string;
	values: Record<string, any>;
}

export interface SessionState {
	sessionId: string;
	active: boolean;
	lastUpdate: string;
	mode: 'builder' | 'preview';
}

export interface AvailableParameter {
	id: string;
	name: string;
	nickname: string;
	description: string;
	category: 'input' | 'output';
	paramType: GrasshopperParamType;
	default?: any;
	minimum?: any;
	maximum?: any;
	stepSize?: number;
	atLeast?: number;
	atMost?: number;
	treeAccess?: boolean;
}

export interface AvailableParameters {
	sessionId: string;
	timestamp: string;
	parameters: AvailableParameter[];
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputLayoutItem {
	return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputLayoutItem {
	return item.type === 'output';
}

// Widget-specific type guards
export function isSliderWidget(item: LayoutItem): item is Extract<InputLayoutItem, { widgetType: 'slider' }> {
	return item.type === 'input' && item.widgetType === 'slider';
}

export function isNumberWidget(item: LayoutItem): item is Extract<InputLayoutItem, { widgetType: 'number' }> {
	return item.type === 'input' && item.widgetType === 'number';
}

export function isTextWidget(item: LayoutItem): item is Extract<InputLayoutItem, { widgetType: 'text' }> {
	return item.type === 'input' && item.widgetType === 'text';
}

export function isDropdownWidget(item: LayoutItem): item is Extract<InputLayoutItem, { widgetType: 'dropdown' }> {
	return item.type === 'input' && item.widgetType === 'dropdown';
}

export function isCheckboxWidget(item: LayoutItem): item is Extract<InputLayoutItem, { widgetType: 'checkbox' }> {
	return item.type === 'input' && item.widgetType === 'checkbox';
}
