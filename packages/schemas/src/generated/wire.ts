/* eslint-disable */
/**
 * This file was automatically generated from packages/schemas/wire-schema.json.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file
 * and run `pnpm generate` at the repo root to regenerate it.
 */

import type { ParamType } from './schema.js';

export type SolveEndedKind = 'ok' | 'blocked' | 'aborted' | 'error';

/**
 * Messages and runtime state the plugin, the Selva server and the browser exchange. Never saved into a .gh, so it carries no schemaVersion: the fixtures in fixtures/wire/ pin it instead.
 */
export interface SelvaWireSchema {
	[k: string]: unknown | undefined;
}
export interface DiscoveredInput {
	/**
	 * Grasshopper parameter instance GUID
	 */
	id: string;
	name: string;
	nickname: string;
	description: string;
	type: ParamType;
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
	 * File extensions the parameter accepts (e.g. ['.png', '.svg'] for an image input, geometry formats for a file input). Used to seed the file widget's accepted-formats default.
	 */
	acceptedFormats?: string[];
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
export interface SolveEvent {
	solveId: string;
	/**
	 * Per-solve, monotonic from 1. Lets a consumer drop late or duplicate delivery.
	 */
	seq: number;
	/**
	 * ISO-8601 UTC timestamp
	 */
	at: string;
	/**
	 * Event kind: solveStarted, solveEnded, diagnostic, progress, valueListUpdated, ...
	 */
	type: string;
	payload?: {
		[k: string]: unknown | undefined;
	};
}
export interface SolveDiagnostic {
	level: 'error' | 'warning' | 'remark';
	/**
	 * What the author wrote, transport decoration stripped.
	 */
	message: string;
	/**
	 * Nickname of the component that raised it.
	 */
	source?: string;
	/**
	 * Raised by a Selva Message component: the author chose to say this. Only these interrupt the user.
	 */
	isGate?: boolean;
}
export interface SolveOutcome {
	diagnostics: SolveDiagnostic[];
	/**
	 * A Message component raised an error, or the solve was aborted. The outputs are not a result.
	 */
	blocked: boolean;
	/**
	 * The solve was stopped before it finished.
	 */
	aborted: boolean;
}
export interface SolveStartedPayload {}
export interface SolveEndedPayload {
	kind: SolveEndedKind;
}
export interface ProgressPayload {
	/**
	 * What is progressing; one bar per source.
	 */
	source?: string;
	/**
	 * 0..1. Absent means indeterminate.
	 */
	fraction?: number;
	done?: number;
	total?: number;
	label?: string;
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
