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

const LEVELS = new Set(['error', 'warning', 'remark']);

/**
 * Normalizes a wire outcome: unknown levels read as remarks, text is trimmed, empty and exactly
 * repeated messages are dropped, and `source`/`isGate` are omitted rather than null or false, so
 * the same verdict decodes to the same object from either transport. Null when `wire` is not an
 * outcome at all; the caller then falls back.
 */
export function decodeOutcome(wire: unknown): SolveOutcome | null {
	if (!wire || typeof wire !== 'object') return null;
	const raw = wire as { diagnostics?: unknown; blocked?: unknown; aborted?: unknown };
	if (!Array.isArray(raw.diagnostics)) return null;

	const seen = new Set<string>();
	const diagnostics: SolveDiagnostic[] = [];
	for (const entry of raw.diagnostics) {
		if (!entry || typeof entry !== 'object') continue;
		const d = entry as Record<string, unknown>;
		const message = typeof d.message === 'string' ? d.message.trim() : '';
		if (!message) continue;
		const level = (LEVELS.has(d.level as string) ? d.level : 'remark') as SolveDiagnostic['level'];
		const source = typeof d.source === 'string' && d.source ? d.source : undefined;
		const isGate = d.isGate === true;
		const key = `${level}\u0000${message}\u0000${source ?? ''}\u0000${isGate}`;
		if (seen.has(key)) continue;
		seen.add(key);
		diagnostics.push({
			level,
			message,
			...(source ? { source } : {}),
			...(isGate ? { isGate } : {})
		});
	}

	const aborted = raw.aborted === true;
	return { diagnostics, blocked: raw.blocked === true || aborted, aborted };
}

/** The legacy verdict, read from Compute's flattened `errors`/`warnings` and their markers. */
export function outcomeFromComputeMessages(
	errors: readonly string[],
	warnings: readonly string[]
): SolveOutcome {
	return {
		diagnostics: parseComputeDiagnostics(errors, warnings),
		// Substring, not prefix: the server numbers each entry ("1. Solution exception: ...").
		blocked: errors.some((e) => e.includes(SOLVE_BLOCKED_MARKER)),
		aborted: false
	};
}

/**
 * Builds the result a driver reports. A blocked or aborted outcome is "no result" whatever the
 * transport sent along: no outputs, and an empty mesh list so the viewer clears. `errors` and
 * `warnings` are derived from the diagnostics for hosts that only want text.
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
		...(partial.source !== undefined ? { source: partial.source } : {})
	};
}
