// Numeric step-size and precision handling for slider-backed inputs.

import type { InputParamSchema } from '../../types';

export function applyRounding(value: number, decimalPlaces: number, tolerance: number): number {
	const rounded = Number(value.toFixed(decimalPlaces));
	if (Math.abs(value - rounded) < tolerance) return rounded;
	return value;
}

export function getInputStepSize(value: number, roundingTolerance: number): number {
	if (!Number.isFinite(value)) return 0.1;
	if (value === 0) return 0.1;

	const abs = Math.abs(value);

	if (abs >= 1) {
		const str = String(value);
		const decimalPart = str.split('.')[1];
		if (decimalPart && decimalPart.length > 0) {
			const decimals = Math.min(decimalPart.length, 12);
			const step = Math.pow(10, -decimals);
			const rounded = Number(step.toFixed(decimals));
			return Math.abs(rounded - step) < roundingTolerance ? rounded : step;
		}
		return 1;
	}

	// Handle exponential notation
	const s = String(value);
	const expMatch = s.toLowerCase().match(/e(-?\d+)/);
	if (expMatch) {
		const exp = Number(expMatch[1]);
		if (exp < 0 || s.toLowerCase().includes('e-')) {
			const absExp = Math.abs(exp);
			const step = Math.pow(10, -absExp);
			const rounded = Number(step.toFixed(absExp));
			return Math.abs(rounded - step) < roundingTolerance ? rounded : step;
		}
		return 0.1;
	}

	// Handle standard decimal notation
	const MAX_DECIMALS = 12;
	const fixed = abs.toFixed(MAX_DECIMALS);
	const trimmed = fixed.replace(/0+$/, '');
	const decimals = Math.min((trimmed.split('.')[1] || '').length, MAX_DECIMALS);

	if (decimals === 0) return 0.1;

	const step = Math.pow(10, -decimals);
	const rounded = Number(step.toFixed(decimals));
	return Math.abs(rounded - step) < roundingTolerance ? rounded : step;
}

/**
 * A server-authored `stepSize` (read off the wire by `normalizeInputSchema`),
 * or `undefined` when absent/unusable — callers fall back to the heuristic.
 */
export function serverStepSize(schema: InputParamSchema): number | undefined {
	return typeof schema.stepSize === 'number' &&
		Number.isFinite(schema.stepSize) &&
		schema.stepSize > 0
		? schema.stepSize
		: undefined;
}

/**
 * Computes the coerced default + stepSize for a Number/Integer input.
 * Mirrors the old `processNumericInput`, plus: a server-provided
 * `schema.stepSize` is honored verbatim; the default/min/max heuristic is
 * only the fallback when the server didn't author one.
 */
