// TypeScript types matching the C# schema models

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

/**
 * Base parameter schema - tracked by Grasshopper instance GUID
 */
export interface IoParamSchema {
	/** Grasshopper component instance GUID - stable reference across document saves */
	id: string;
	name: string;
	nickname: string;
	/** Grasshopper parameter type (Number, Text, Boolean, Point, Geometry, etc.) */
	paramType: "Number" | "Integer" | "Text" | "Boolean"
}

/**
 * Input parameter schema - matches Rhino Compute input format
 */
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

/**
 * Output parameter schema
 */
export interface OutputParamSchema extends IoParamSchema {
	description?: string;
}

// ============================================================================
// UI LAYOUT SCHEMA (ComputeBuilder-specific)
// ============================================================================

/**
 * Layout item referencing a parameter with UI-specific configuration
 */
export interface LayoutItem {
	/** Unique layout item ID (generated for each layout placement) */
	id: string;
	/** References the Grasshopper component InstanceGuid (from InputParamSchema.id or OutputParamSchema.id) */
	paramId: string;
	type: 'input' | 'output';
	/** Override display name (optional - if null, uses parameter's nickname or name) */
	displayName?: string;
	/** Widget type for rendering this parameter
	 * Inputs: "slider", "number", "text", "dropdown", "checkbox", "color"
	 * Outputs: "text", "number", "3d-viewer", "chart"
	 */
	widgetType: string;
	order?: number;
	span?: number;
	config: WidgetConfig;
}

/**
 * Widget-specific configuration (consolidated from InputConfig/OutputConfig)
 */
export interface WidgetConfig {
	// Number/slider widgets
	min?: number;
	max?: number;
	step?: number;
	// Dropdown widgets
	options?: string[];
	// Text input widgets
	placeholder?: string;
	required?: boolean;
	// Output display widgets
	format?: string;
	unit?: string;
	chartType?: 'line' | 'bar' | 'pie';
}

/**
 * Layout configuration for the UI
 */
export interface LayoutConfig {
	/** Layout type:
	 * - "tabbed": Multi-tab interface with groups
	 * - "flat": Simple single-column list of all parameters
	 */
	type: 'tabbed' | 'flat';
	gap: number;
	// For "tabbed" layout
	tabs?: TabConfig[];
	// For "flat" layout
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
	paramType: "Number" | "Integer" | "Text" | "Boolean"; // Grasshopper parameter type (Number, Text, Boolean, Point, Geometry, etc.)
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


