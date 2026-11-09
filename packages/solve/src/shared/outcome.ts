// The one place a solve's verdict becomes a `SolveResult`. The plugin decides the verdict
// (`SolveOutcome`: diagnostics, blocked, aborted) once, and both transports carry it: the local
// `outputs` envelope and the VektorNode fork's `selva` block. Each driver decodes it here, so a
// rule about what a verdict means is written once rather than once per transport.
//
// A Compute response without a `selva` block (stock server, older plugin) falls back to
// `outcomeFromComputeMessages`, which recovers what it can from the flattened strings. It cannot
// see remarks or an abort.

import type { SolveOutcome } from '@selvajs/schemas';
import { parseComputeDiagnostics } from './compute-diagnostics.js';
import { SOLVE_BLOCKED_MARKER, type SolveDiagnostic, type SolveResult } from './solve-fn.js';

export type { SolveOutcome };

function isLevel(value: unknown): value is SolveDiagnostic['level'] {
	return value === 'error' || value === 'warning' || value === 'remark';
}

/**
 * One wire diagnostic, normalized: an unknown level reads as a remark, text is trimmed, and
 * `source`/`isGate` are omitted rather than null or false. Null when it carries no message.
 */
export function decodeDiagnostic(entry: unknown): SolveDiagnostic | null {
	if (!entry || typeof entry !== 'object') return null;
	const d = entry as Record<string, unknown>;
	const message = typeof d.message === 'string' ? d.message.trim() : '';
	if (!message) return null;
	const source = typeof d.source === 'string' && d.source ? d.source : undefined;
	return {
		level: isLevel(d.level) ? d.level : 'remark',
		message,
		...(source ? { source } : {}),
		...(d.isGate === true ? { isGate: true } : {})
	};
}

function normalizeOutcome(
	entries: readonly unknown[],
	blocked: boolean,
	aborted: boolean,
	deferred?: string[]
): SolveOutcome {
	const seen = new Set<string>();
	const diagnostics: SolveDiagnostic[] = [];
	for (const entry of entries) {
		const d = decodeDiagnostic(entry);
		if (!d) continue;
		const key = `${d.level}\u0000${d.message}\u0000${d.source ?? ''}\u0000${d.isGate === true}`;
		if (seen.has(key)) continue;
		seen.add(key);
		diagnostics.push(d);
	}
	return {
		diagnostics,
		blocked: blocked || aborted,
		aborted,
		...(deferred && deferred.length > 0 ? { deferred } : {})
	};
}

/**
 * Normalizes a wire outcome with `decodeDiagnostic`, dropping exact repeats, so the same verdict
 * decodes to the same object from either transport. Null when `wire` is not an outcome at all;
 * the caller then falls back. A verdict without a diagnostic list still counts: reading a refusal
 * as "no outcome" would let the solve through.
 */
export function decodeOutcome(wire: unknown): SolveOutcome | null {
	if (!wire || typeof wire !== 'object') return null;
	const { diagnostics, blocked, aborted, deferred } = wire as Record<string, unknown>;
	const hasList = Array.isArray(diagnostics);
	if (!hasList && blocked === undefined && aborted === undefined) return null;
	// `'true'` too: a flag that arrives stringified must fail closed, not let a refusal through.
	const isTrue = (flag: unknown) => flag === true || flag === 'true';
	const deferredIds = Array.isArray(deferred)
		? deferred.filter((id): id is string => typeof id === 'string' && id !== '')
		: undefined;
	return normalizeOutcome(
		hasList ? diagnostics : [],
		isTrue(blocked),
		isTrue(aborted),
		deferredIds
	);
}

/** The legacy verdict, read from Compute's flattened `errors`/`warnings` and their markers. */
export function outcomeFromComputeMessages(
	errors: readonly unknown[],
	warnings: readonly unknown[]
): SolveOutcome {
	const strings = (list: readonly unknown[]) => list.filter((m) => typeof m === 'string');
	const errorText = strings(errors);
	return normalizeOutcome(
		parseComputeDiagnostics(errorText, strings(warnings)),
		// Substring, not prefix: the server numbers each entry ("1. Solution exception: ...").
		errorText.some((e) => e.includes(SOLVE_BLOCKED_MARKER)),
		false
	);
}

/**
 * Builds the result a driver reports. A blocked or aborted outcome is "no result" whatever the
 * transport sent along: no outputs, no `source` (it holds the withheld outputs), and an empty mesh
 * list so the viewer clears. `errors` and `warnings` are derived from the diagnostics for hosts
 * that only want text.
 */
export function finalizeResult<TMesh, TSource>(
	partial: { outputs: Record<string, unknown>; meshes?: TMesh[]; source?: TSource },
	outcome: SolveOutcome
): SolveResult<TMesh, TSource> {
	const rejected = outcome.blocked || outcome.aborted;
	const meshes = rejected ? [] : partial.meshes;
	return {
		outputs: rejected ? {} : partial.outputs,
		...(meshes !== undefined ? { meshes } : {}),
		errors: outcome.diagnostics.filter((d) => d.level === 'error').map((d) => d.message),
		warnings: outcome.diagnostics.filter((d) => d.level === 'warning').map((d) => d.message),
		diagnostics: outcome.diagnostics,
		blocked: outcome.blocked,
		aborted: outcome.aborted,
		...(outcome.deferred && !rejected ? { deferred: outcome.deferred } : {}),
		...(partial.source !== undefined && !rejected ? { source: partial.source } : {})
	};
}
