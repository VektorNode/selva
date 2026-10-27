import type { InputParamSchema } from '../../types';

/** Snap float noise (`0.30000000000000004`) to `decimalPlaces`; a real difference is kept. */
export function applyRounding(value: number, decimalPlaces: number): number {
	const rounded = Number(value.toFixed(decimalPlaces));
	return Math.abs(value - rounded) < 1e-8 ? rounded : value;
}

const MAX_DECIMALS = 12;
// A double holds 15 significant digits exactly. Fixed places would not do: from 1e4 up,
// `toFixed(12)` prints the float's own noise (`16384.200000000001`).
const SIGNIFICANT_DIGITS = 15;

/**
 * Decimal places `x` is written with, ignoring float noise, at most 12:
 * `0.30000000000000004` → 1, `16384.2` → 1, `1e-7` → 7, `1.5e21` → 0.
 */
export function decimalsOf(x: number): number {
	if (!Number.isFinite(x)) return 0;
	const clean = Number(Math.abs(x).toPrecision(SIGNIFICANT_DIGITS));
	const [mantissa, exponent = '0'] = String(clean).split('e');
	const decimals = (mantissa.split('.')[1]?.length ?? 0) - Number(exponent);
	return Math.min(Math.max(decimals, 0), MAX_DECIMALS);
}

export function getInputStepSize(value: number): number {
	if (!Number.isFinite(value) || value === 0) return 0.1;
	const decimals = decimalsOf(value);
	if (decimals === 0) return Math.abs(value) >= 1 ? 1 : 0.1;
	return Number((10 ** -decimals).toFixed(decimals));
}

/** A server-authored `stepSize`, or `undefined` when absent or unusable. */
export function serverStepSize(schema: InputParamSchema): number | undefined {
	return typeof schema.stepSize === 'number' &&
		Number.isFinite(schema.stepSize) &&
		schema.stepSize > 0
		? schema.stepSize
		: undefined;
}
