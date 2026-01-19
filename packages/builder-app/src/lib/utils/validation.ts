import type { VisibilityRule, DiscoveredInput, GrasshopperParamType } from '@selva/shared';

/**
 * Validates a visibility rule value against parameter constraints
 */
export function validateRuleValue(
	rule: VisibilityRule,
	paramInfo?: DiscoveredInput
): string | null {
	if (!paramInfo || !rule.value) return null;

	// Number validation
	if (paramInfo.type === 'number' || paramInfo.type === 'integer') {
		const numValue = Number(rule.value);

		if (isNaN(numValue)) {
			return 'Value must be a valid number';
		}

		if (paramInfo.minimum !== undefined && numValue < paramInfo.minimum) {
			return `Value must be >= ${paramInfo.minimum}`;
		}

		if (paramInfo.maximum !== undefined && numValue > paramInfo.maximum) {
			return `Value must be <= ${paramInfo.maximum}`;
		}
	}

	// Value list validation
	if (paramInfo.type === 'valueList' && paramInfo.options) {
		const validValues = Object.values(paramInfo.options);
		if (!validValues.includes(String(rule.value))) {
			return `Value must be one of: ${validValues.join(', ')}`;
		}
	}

	// Boolean validation
	if (paramInfo.type === 'boolean') {
		const boolValue = String(rule.value).toLowerCase();
		if (boolValue !== 'true' && boolValue !== 'false') {
			return 'Value must be true or false';
		}
	}

	return null;
}

/**
 * Validates a default value against parameter constraints
 */
export function validateDefaultValue(
	value: unknown,
	paramInfo?: DiscoveredInput
): string | null {
	if (!paramInfo || value === undefined || value === null) return null;

	// Number validation
	if (paramInfo.type === 'number' || paramInfo.type === 'integer') {
		const numValue = Number(value);

		if (isNaN(numValue)) {
			return 'Default value must be a valid number';
		}

		if (paramInfo.minimum !== undefined && numValue < paramInfo.minimum) {
			return `Default value must be >= ${paramInfo.minimum}`;
		}

		if (paramInfo.maximum !== undefined && numValue > paramInfo.maximum) {
			return `Default value must be <= ${paramInfo.maximum}`;
		}
	}

	// Value list validation
	if (paramInfo.type === 'valueList' && paramInfo.options) {
		const validValues = Object.values(paramInfo.options);
		if (!validValues.includes(String(value))) {
			return `Default value must be one of: ${validValues.join(', ')}`;
		}
	}

	// Boolean validation
	if (paramInfo.type === 'boolean') {
		if (typeof value !== 'boolean') {
			return 'Default value must be true or false';
		}
	}

	return null;
}

/**
 * Returns appropriate operators based on parameter type
 */
export function getOperatorsForType(
	paramType?: GrasshopperParamType
): { value: string; label: string }[] {
	const baseOperators = [
		{ value: 'equals', label: 'equals' },
		{ value: 'notEquals', label: 'not equals' }
	];

	if (paramType === 'number' || paramType === 'integer') {
		return [
			...baseOperators,
			{ value: 'greaterThan', label: '>' },
			{ value: 'lessThan', label: '<' },
			{ value: 'greaterThanOrEqual', label: '>=' },
			{ value: 'lessThanOrEqual', label: '<=' },
			{ value: 'between', label: 'between' }
		];
	}

	if (paramType === 'valueList' || paramType === 'text') {
		return [
			...baseOperators,
			{ value: 'in', label: 'in' },
			{ value: 'notIn', label: 'not in' }
		];
	}

	if (paramType === 'boolean') {
		return baseOperators;
	}

	// Default: all operators for generic types
	return [
		...baseOperators,
		{ value: 'greaterThan', label: '>' },
		{ value: 'lessThan', label: '<' },
		{ value: 'greaterThanOrEqual', label: '>=' },
		{ value: 'lessThanOrEqual', label: '<=' },
		{ value: 'in', label: 'in' },
		{ value: 'notIn', label: 'not in' },
		{ value: 'between', label: 'between' }
	];
}
