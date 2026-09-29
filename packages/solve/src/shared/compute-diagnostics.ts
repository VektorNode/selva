// Rhino.Compute reports runtime messages as flat strings, so everything the UI needs to tell a
// deliberate message from incidental noise has to be recovered from the text. This is the one
// place that parsing happens.
//
// Two decorations are applied by the server, in this order:
//   "<author's text>: component \"<Name>\" (<guid>)"   — LogRuntimeMessages, every message
//   "<n>. Solution exception:<marker> ..."              — the numbered-error wrapper
// The local WebSocket path carries the same facts structurally and never comes through here.

import {
	SOLVE_AUTHORED_MARKER,
	SOLVE_BLOCKED_MARKER,
	SOLVE_LOG_ONLY_MARKER,
	type SolveDiagnostic
} from '../shared/solve-fn.js';

/**
 * Compute's per-message attribution suffix. Anchored to the end and requiring the parenthesised
 * GUID, so an author who writes `component "x"` mid-sentence keeps their text intact.
 */
const ATTRIBUTION = /:\s*component\s+"([^"]*)"\s*\(([0-9a-fA-F-]{36}|\.\.\.)\)\s*$/;

/** The Selva Message component's own name, as `LogRuntimeMessages` reports it. */
const MESSAGE_COMPONENT_NAME = 'Message';

export interface ParsedComputeMessage {
	/** The author's text, with the attribution suffix and any marker removed. */
	message: string;
	/** Component name from the attribution suffix, when present. */
	source?: string;
	/** Carried the block marker: a Message component refused the solve. */
	blocked: boolean;
	/** Carried any marker: a Message component wrote this. */
	authored: boolean;
	/** The author chose Notify = Log: list it, but do not interrupt. */
	logOnly: boolean;
}

/**
 * Splits one Compute message string into the author's text and its attribution.
 *
 * Leaves the text alone when the suffix is absent — an exception thrown by a script component
 * has no attribution and must not be truncated on a guess.
 */
export function parseComputeMessage(raw: string): ParsedComputeMessage {
	const blocked = raw.includes(SOLVE_BLOCKED_MARKER);
	const logOnly = !blocked && raw.includes(SOLVE_LOG_ONLY_MARKER);
	const authored = blocked || logOnly || raw.includes(SOLVE_AUTHORED_MARKER);
	let message = raw;

	let source: string | undefined;
	const attribution = ATTRIBUTION.exec(message);
	if (attribution) {
		source = attribution[1] || undefined;
		message = message.slice(0, attribution.index);
	}

	if (authored) {
		message = message
			.replace(SOLVE_BLOCKED_MARKER, '')
			.replace(SOLVE_AUTHORED_MARKER, '')
			.replace(SOLVE_LOG_ONLY_MARKER, '')
			// The numbered wrapper reads as noise next to the author's own sentence. Dropped only
			// when a marker proves the text is one of ours.
			.replace(/^\s*\d+\.\s*Solution exception:\s*/, '');
	}

	return { message: message.replace(/\s{2,}/g, ' ').trim(), source, blocked, authored, logOnly };
}

/**
 * Rebuilds structured diagnostics from Compute's `errors`/`warnings` arrays.
 *
 * `isGate` comes from the marker the component writes. The component-name fallback is for
 * definitions saved before the non-blocking marker existed; `obj.Name` is the component's type
 * name, not its nickname, so renaming one on the canvas cannot change how it behaves.
 */
export function parseComputeDiagnostics(
	errors: readonly string[],
	warnings: readonly string[]
): SolveDiagnostic[] {
	const build = (raw: string, level: 'error' | 'warning'): SolveDiagnostic => {
		const { message, source, authored, logOnly } = parseComputeMessage(raw);
		const isGate = (authored || source === MESSAGE_COMPONENT_NAME) && !logOnly;
		return { level, message, ...(source ? { source } : {}), ...(isGate ? { isGate } : {}) };
	};
	return [
		...errors.map((raw) => build(raw, 'error')),
		...warnings.map((raw) => build(raw, 'warning'))
	];
}
