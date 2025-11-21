import { createNumericTransformer, processInputValue } from './parser-utils';

import type { InputParamSchema } from '../../../types';

/**
 * Processes numeric input parameters including step size and decimal places
 *
 * @internal This is an internal parser used by `processInput()`. Use `fetchParsedDefinitionIO()` instead.
 *
 * @param input - The input parameter schema to process
 * @param roundingTolerance - Threshold for rounding to avoid floating-point artifacts (default: 1e-8)
 */
export default function processNumericInput(
  input: InputParamSchema,
  roundingTolerance: number = 1e-8,
): void {
  const isIntegerType = input.paramType === 'Integer';

  // Convert string values to numbers using shared utility
  processInputValue(input, {
    transform: createNumericTransformer(),
  });

  // Round to integer if it's an integer type
  if (isIntegerType) {
    if (Array.isArray(input.default)) {
      input.default = input.default.map((val) => (typeof val === 'number' ? Math.round(val) : val));
    } else if (typeof input.default === 'number') {
      input.default = Math.round(input.default);
    }

    // Integer inputs always have step size of 1
    input.stepSize = 1;
    return; // No further processing needed for integers
  }

  // Calculate step size from the first numeric value
  const firstValue = Array.isArray(input.default) ? input.default[0] : input.default;

  // Use default value as the primary source for step size calculation
  let stepSource: number | undefined;

  if (typeof firstValue === 'number' && Number.isFinite(firstValue) && firstValue !== 0) {
    stepSource = firstValue;
  } else if (
    typeof input.minimum === 'number' &&
    Number.isFinite(input.minimum) &&
    input.minimum !== 0
  ) {
    stepSource = input.minimum;
  } else if (
    typeof input.maximum === 'number' &&
    Number.isFinite(input.maximum) &&
    input.maximum !== 0
  ) {
    stepSource = input.maximum;
  }

  if (stepSource !== undefined) {
    input.stepSize = getInputStepSize(stepSource, roundingTolerance);
  } else {
    // Default step size if no step detected
    input.stepSize = 0.1; // Use 0.1 for decimal numbers instead of 1
  }

  // Apply precision to all numeric values
  if (typeof input.stepSize === 'number') {
    let decimalPlaces = 0;
    const stepStr = String(input.stepSize);

    const expMatch = stepStr.toLowerCase().match(/e(-?\d+)/); // Capture sign with exponent
    if (expMatch) {
      decimalPlaces = Math.abs(Number(expMatch[1])); // Use absolute value
    } else {
      decimalPlaces = stepStr.split('.')[1]?.length ?? 0;
    }

    // Infer decimal places from small values when step size doesn't provide enough precision
    if (
      decimalPlaces === 0 &&
      typeof firstValue === 'number' &&
      firstValue !== 0 &&
      Math.abs(firstValue) < 1
    ) {
      const inferred = Math.ceil(-Math.log10(Math.abs(firstValue)));
      if (Number.isFinite(inferred) && inferred > 0) {
        decimalPlaces = inferred;
      }
    }

    decimalPlaces = Math.min(Math.max(decimalPlaces, 0), 12);

    // Apply precision to all values
    if (Array.isArray(input.default)) {
      input.default = input.default.map((val) =>
        typeof val === 'number' ? applyRounding(val, decimalPlaces, roundingTolerance) : val,
      );
    } else if (typeof input.default === 'number') {
      input.default = applyRounding(input.default, decimalPlaces, roundingTolerance);
    }
  }
}

/**
 * Applies rounding with tolerance to avoid floating-point artifacts
 */
function applyRounding(value: number, decimalPlaces: number, tolerance: number): number {
  const rounded = Number(value.toFixed(decimalPlaces));

  // If the difference is within tolerance, use the rounded value
  if (Math.abs(value - rounded) < tolerance) {
    return rounded;
  }

  return value;
}

/**
 * Calculates the step size for a given numeric input value based on its decimal precision.
 * Works for normal decimals and numbers expressed in exponential form.
 * @param value - The numeric value to calculate step size for
 * @param roundingTolerance - Threshold for rounding to avoid floating-point artifacts
 */
function getInputStepSize(value: number, roundingTolerance: number = 1e-8): number {
  if (!Number.isFinite(value)) return 0.1;
  if (value === 0) return 0.1;

  const abs = Math.abs(value);

  // If value >= 1 => step of 0.1 for decimals, or infer from decimal places
  if (abs >= 1) {
    // Check if it has decimal places
    const str = String(value);
    const decimalPart = str.split('.')[1];
    if (decimalPart && decimalPart.length > 0) {
      const decimals = Math.min(decimalPart.length, 12);
      const step = Math.pow(10, -decimals);
      const rounded = Number(step.toFixed(decimals));
      return Math.abs(rounded - step) < roundingTolerance ? rounded : step;
    }
    return 1; // Integer value
  }

  // Handle exponential notation
  const s = String(value);
  const expMatch = s.toLowerCase().match(/e(-?\d+)/); // Capture sign with exponent
  if (expMatch) {
    const exp = Number(expMatch[1]);
    // If exponent is negative (e-5), return 10^-5
    if (exp < 0 || s.toLowerCase().includes('e-')) {
      const absExp = Math.abs(exp);
      const step = Math.pow(10, -absExp);
      // Round to avoid binary floating-point artifacts
      const rounded = Number(step.toFixed(absExp));
      return Math.abs(rounded - step) < roundingTolerance ? rounded : step;
    }
    return 0.1;
  }

  // Handle standard decimal notation
  const MAX_DECIMALS = 12;
  const fixed = abs.toFixed(MAX_DECIMALS); // e.g. "0.000010000000"
  const trimmed = fixed.replace(/0+$/, ''); // Remove trailing zeros
  const decimals = Math.min((trimmed.split('.')[1] || '').length, MAX_DECIMALS);

  if (decimals === 0) return 0.1;

  const step = Math.pow(10, -decimals);
  // Round to produce a clean decimal (e.g. 0.00001)
  const rounded = Number(step.toFixed(decimals));
  return Math.abs(rounded - step) < roundingTolerance ? rounded : step;
}
