// Numeric step-size and precision handling for slider-backed inputs.

import type { InputParamSchema } from '../../types';

export function applyRounding(value: number, decimalPlaces: number, tolerance: number): number {
	const rounded = Number(value.toFixed(decimalPlaces));
	if (Math.abs(value - rounded) < tolerance) return rounded;
	return value;
}

const MAX_DECIMALS = 12;

/**
 * Decimal places `x` is written with, ignoring float noise past 12 places:
 * `0.30000000000000004` → 1, `1e-7` → 7, `1.5e21` → 0.
 */
export function decimalsOf(x: number): number {
	if (!Number.isFinite(x)) return 0;
	const [mantissa, exponent] = String(Math.abs(x)).split('e');
	const decimals =
		exponent === undefined
			? (Math.abs(x).toFixed(MAX_DECIMALS).replace(/0+$/, '').split('.')[1]?.length ?? 0)
			: (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
	return Math.min(Math.max(decimals, 0), MAX_DECIMALS);
}

export function getInputStepSize(value: number): number {
	if (!Number.isFinite(value) || value === 0) return 0.1;
	const decimals = decimalsOf(value);
	if (decimals === 0) return Math.abs(value) >= 1 ? 1 : 0.1;
	return Number((10 ** -decimals).toFixed(decimals));
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
