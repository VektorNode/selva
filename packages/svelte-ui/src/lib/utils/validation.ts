import type { NumericInputType } from '@computebuilder/core/grasshopper';

/**
 * Validation result for numeric inputs
 */
export type ValidationResult = {
  isValid: boolean;
  clampedValue: number;
  warningMessage: string;
};

/**
 * Validates and clamps a numeric value based on input constraints
 */
export function validateNumber(value: string | number, input: NumericInputType): ValidationResult {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  // Check if it's a valid number
  if (isNaN(numValue) || !isFinite(numValue)) {
    const defaultValue = typeof input.default === 'number' ? input.default : 0;
    return {
      isValid: false,
      clampedValue: defaultValue,
      warningMessage: 'Invalid number',
    };
  }

  let clampedValue = numValue;
  let warningMessage = '';
  let isValid = true;

  // Check minimum
  if (input.minimum !== null && input.minimum !== undefined && numValue < input.minimum) {
    clampedValue = input.minimum;
    warningMessage = `Value will be adjusted to minimum ${input.minimum}`;
    isValid = false;
  }

  // Check maximum
  if (input.maximum !== null && input.maximum !== undefined && numValue > input.maximum) {
    clampedValue = input.maximum;
    warningMessage = `Value will be adjusted to maximum ${input.maximum}`;
    isValid = false;
  }

  // For Integer type, round to nearest integer
  if (input.paramType === 'Integer') {
    clampedValue = Math.round(clampedValue);
  }

  return { isValid, clampedValue, warningMessage };
}

/**
 * Get slider configuration from input
 */
export function getSliderConfig(input: NumericInputType) {
  return {
    min: input.minimum ?? 0,
    max: input.maximum ?? 100,
    step: input.paramType === 'Integer' ? 1 : (input.stepSize ?? 0.1),
  };
}
