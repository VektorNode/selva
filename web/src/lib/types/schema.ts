// TypeScript types matching the C# schema models

export interface UISchema {
	id: string;
	name: string;
	description: string;
	version: string;
	created: string;
	inputs: InputParameter[];
	outputs: OutputParameter[];
	layout: LayoutConfig;
	enable3dViewer: boolean;
}

export interface InputParameter {
	grasshopperId: string;
	name: string;
	nickname?: string;
	type: 'number' | 'slider' | 'dropdown' | 'text' | 'checkbox' | 'color';
	default?: any;
	grasshopperParamName: string;

	// Compute-style metadata
	description?: string;
	paramType?: string; // Grasshopper parameter type (Number, Text, Boolean, Point, Geometry, etc.)
	atLeast?: number;
	atMost?: number;
	treeAccess?: boolean;
	minimum?: any;
	maximum?: any;

	// UI Builder metadata
	groupName?: string; // Group this parameter belongs to
	displayName?: string; // Alternative display name for the UI
	order?: number; // Display order within the group
	tooltip?: string; // Additional help text

	config: InputConfig;
	isExpired?: boolean;
}

export interface InputConfig {
	min?: number;
	max?: number;
	step?: number;
	options?: string[];
	placeholder?: string;
	required?: boolean;
}

export interface OutputParameter {
	grasshopperId: string;
	name: string;
	nickname?: string;
	type: 'text' | 'number' | '3d-viewer' | 'chart';
	grasshopperParamName: string;

	// Compute-style metadata
	paramType?: string; // Grasshopper parameter type

	// UI Builder metadata
	groupName?: string; // Group this output belongs to
	displayName?: string; // Alternative display name for the UI
	order?: number; // Display order within the group
	description?: string;

	config: OutputConfig;
	isExpired?: boolean;

	// Note: Outputs don't have default values - they show live data from Grasshopper
}

export interface OutputConfig {
	format?: string;
	unit?: string;
	chartType?: 'line' | 'bar' | 'pie';
}

export interface LayoutConfig {
	type: 'grid' | 'flex' | 'tabbed';
	columns: number;
	gap: number;
	tabs: TabConfig[];
	items: LayoutItem[]; // Legacy grid layout
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
	items: GroupItem[];
}

export interface GroupItem {
	id: string;
	parameterId: string;
	type: 'input' | 'output';
	displayName?: string;
	order: number;
	span: number;
}

export interface LayoutItem {
	id: string;
	row: number;
	column: number;
	width: number;
	height: number;
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
	paramType: string; // Grasshopper parameter type (Number, Text, Boolean, Point, Geometry, etc.)
	default?: any;
	minimum?: any;
	maximum?: any;
	atLeast?: number;
	atMost?: number;
	treeAccess?: boolean;
}

export interface AvailableParameters {
	sessionId: string;
	timestamp: string;
	parameters: AvailableParameter[];
}


