import type {
	VisibilityRule,
	DiscoveredInput,
	GrasshopperParamType,
	UISchema,
	SchemaInput,
	SchemaOutput,
	LayoutItem
} from '@selvajs/schemas';

/**
 * Validates a visibility rule value against parameter constraints
 */
export function validateRuleValue(
	rule: VisibilityRule,
	paramInfo?: DiscoveredInput
): string | null {
	if (!paramInfo) return null;

	// 'isEmpty' / 'isNotEmpty' take no value
	if (rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty') {
		return null;
	}

	// Validate 'in', 'notIn', and 'containsAny' operators (which use rule.values array)
	if (
		(rule.operator === 'in' || rule.operator === 'notIn' || rule.operator === 'containsAny') &&
		rule.values
	) {
		if (!Array.isArray(rule.values) || rule.values.length === 0) {
			return 'At least one value is required';
		}

		// Validate each value in the array based on parameter type
		for (let i = 0; i < rule.values.length; i++) {
			const val = rule.values[i];

			if (paramInfo.type === 'number' || paramInfo.type === 'integer') {
				const numValue = Number(val);
				if (isNaN(numValue)) {
					return `Value ${i + 1} must be a valid number`;
				}
				if (paramInfo.type === 'integer' && !Number.isInteger(numValue)) {
					return `Value ${i + 1} must be a whole number`;
				}
				if (paramInfo.minimum !== undefined && numValue < paramInfo.minimum) {
					return `Value ${i + 1} must be >= ${paramInfo.minimum}`;
				}
				if (paramInfo.maximum !== undefined && numValue > paramInfo.maximum) {
					return `Value ${i + 1} must be <= ${paramInfo.maximum}`;
				}
			}

			if (paramInfo.type === 'valueList' && paramInfo.options) {
				const validValues = Object.values(paramInfo.options);
				if (!validValues.includes(String(val))) {
					return `Value ${i + 1} must be one of: ${validValues.join(', ')}`;
				}
			}
		}
		return null;
	}

	// Validate 'between' operator (which uses rule.values as [min, max])
	if (rule.operator === 'between' && rule.values) {
		if (!Array.isArray(rule.values) || rule.values.length !== 2) {
			return 'Between operator requires min and max values';
		}

		const minValue = Number(rule.values[0]);
		const maxValue = Number(rule.values[1]);

		if (isNaN(minValue) || isNaN(maxValue)) {
			return 'Both min and max must be valid numbers';
		}

		if (paramInfo && paramInfo.type === 'integer') {
			if (!Number.isInteger(minValue)) {
				return 'Min value must be a whole number';
			}
			if (!Number.isInteger(maxValue)) {
				return 'Max value must be a whole number';
			}
		}

		if (minValue > maxValue) {
			return 'Min value must be less than or equal to max value';
		}

		return null;
	}

	// Validate 'matches' operator (regex pattern)
	if (rule.operator === 'matches' && rule.value) {
		try {
			new RegExp(String(rule.value));
		} catch (err) {
			return `Invalid regex pattern: ${err instanceof Error ? err.message : 'Unknown error'}`;
		}
		return null;
	}

	// Validate single value operators (which use rule.value)
	if (!rule.value) return null;

	// Number validation
	if (paramInfo.type === 'number' || paramInfo.type === 'integer') {
		const numValue = Number(rule.value);

		if (isNaN(numValue)) {
			return 'Value must be a valid number';
		}

		if (paramInfo.type === 'integer' && !Number.isInteger(numValue)) {
			return 'Value must be a whole number';
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
export function validateDefaultValue(value: unknown, paramInfo?: DiscoveredInput): string | null {
	if (!paramInfo || value === undefined || value === null) return null;

	// Number validation
	if (paramInfo.type === 'number' || paramInfo.type === 'integer') {
		const numValue = Number(value);

		if (isNaN(numValue)) {
			return 'Default value must be a valid number';
		}

		if (paramInfo.type === 'integer' && !Number.isInteger(numValue)) {
			return 'Default value must be a whole number';
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

export interface DynamicValueListIssue {
	outputId: string;
	message: string;
}

/**
 * Validate that every dynamic value list output targets an existing dynamic value list input.
 *
 * Reads the targetInputId from the output's layout-item config (the builder's source of truth),
 * falling back to the schema output's targetInputId. Returns one issue per misconfigured output.
 */
export function validateDynamicValueListOutputs(schema: UISchema): DynamicValueListIssue[] {
	const issues: DynamicValueListIssue[] = [];

	const dynamicInputIds = new Set(
		schema.inputs
			.filter((i: SchemaInput) => i.paramType === 'dynamicValueList')
			.map((i: SchemaInput) => i.id)
	);

	const dynamicOutputs = schema.outputs.filter((o: SchemaOutput) => o.type === 'dynamicValueList');

	// targetInputId set per output via the layout-item config (preferred) or the schema output.
	const layoutTargets = new Map<string, string | undefined>();
	const groups =
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.flatMap((t) => t.groups)
			: schema.layout.groups;
	for (const group of groups) {
		for (const item of group.items as LayoutItem[]) {
			if (item.type === 'output' && item.widgetType === 'dynamicValueList') {
				layoutTargets.set(item.paramId, item.config?.targetInputId);
			}
		}
	}

	for (const output of dynamicOutputs) {
		const target = layoutTargets.get(output.id) ?? output.targetInputId;
		if (!target) {
			issues.push({
				outputId: output.id,
				message: `Dynamic value list output "${output.nickname}" has no target input selected.`
			});
		} else if (!dynamicInputIds.has(target)) {
			issues.push({
				outputId: output.id,
				message: `Dynamic value list output "${output.nickname}" targets an input that no longer exists or is not a dynamic value list.`
			});
		}
	}

	return issues;
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

	if (paramType === 'valueList' || paramType === 'dynamicValueList') {
		return [
			...baseOperators,
			{ value: 'in', label: 'in' },
			{ value: 'notIn', label: 'not in' },
			{ value: 'contains', label: 'contains' },
			{ value: 'containsAny', label: 'contains any of' },
			{ value: 'isEmpty', label: 'is empty' },
			{ value: 'isNotEmpty', label: 'is not empty' }
		];
	}

	if (paramType === 'text') {
		return [
			...baseOperators,
			{ value: 'in', label: 'in' },
			{ value: 'notIn', label: 'not in' },
			{ value: 'matches', label: 'matches (regex)' }
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
