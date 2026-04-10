import type {
	UISchema,
	DiscoveredParameters,
	LayoutItem,
	InputLayoutItem,
	InputNumberLayoutItem,
	NumberWidgetConfig
} from '$lib/types/generated';
import { getDefaultValue } from '$lib/utils/utils-shared';

function isInputLayoutItem(item: LayoutItem): item is InputLayoutItem {
	return item.type === 'input';
}

function isNumberInputLayoutItem(item: InputLayoutItem): item is InputNumberLayoutItem {
	return item.widgetType === 'number';
}

interface InitializeValuesOptions {
	schema: UISchema;
	availableParams?: DiscoveredParameters;
	currentValues?: Record<string, unknown>;
}

/**
 * Initialize parameter values for a schema with proper defaults and normalization.
 *
 * Priority order:
 * 1. currentValues (existing values passed in)
 * 2. availableParams.default (from Grasshopper parameter metadata)
 * 3. Type-based defaults (0 for numbers, false for booleans, etc.)
 *
 * Special handling for valueList/dropdown parameters:
 * - Converts label names (e.g., "Cylindrical") to their corresponding values (e.g., "1")
 * - This fixes cases where Grasshopper sends the selected label instead of the index value
 */
export function initializeValues(options: InitializeValuesOptions): Record<string, unknown> {
	const values: Record<string, unknown> = {};

	// Initialize with type-based defaults or available parameter defaults
	options.schema.inputs.forEach((input) => {
		const availableParam = options.availableParams?.inputs?.find((p) => p.id === input.id);
		const defaultValue =
			availableParam?.default !== null && availableParam?.default !== undefined
				? availableParam.default
				: getDefaultValue(input.paramType);

		values[input.id] = defaultValue;
	});

	// Initialize outputs to null
	options.schema.outputs.forEach((output) => {
		values[output.id] = null;
	});

	// Override with current values if provided
	if (options.currentValues && Object.keys(options.currentValues).length > 0) {
		Object.assign(values, options.currentValues);
	}

	// Normalize valueList/dropdown values: convert labels to values if needed
	options.schema.inputs.forEach((input) => {
		if (input.paramType === 'valueList' && values[input.id] != null) {
			const layoutItem = findLayoutItemForInput(options.schema, input.id);
			if (
				layoutItem &&
				isInputLayoutItem(layoutItem) &&
				layoutItem.widgetType === 'dropdown' &&
				layoutItem.config?.options
			) {
				const currentValue = values[input.id];
				const dropdownOptions = layoutItem.config.options;

				// If currentValue matches a label (key), convert to the corresponding value
				if (typeof currentValue === 'string' && currentValue in dropdownOptions) {
					values[input.id] = dropdownOptions[currentValue];
				}
			}
		}
	});

	return values;
}

/**
 * Find a layout item by input parameter ID.
 * Searches through tabbed layout structure to locate the item configuration.
 */
function findLayoutItemForInput(schema: UISchema, inputId: string): LayoutItem | null {
	if (schema.layout.type === 'tabbed') {
		for (const tab of schema.layout.tabs) {
			for (const group of tab.groups) {
				const item = group.items.find((item) => item.type !== 'linebreak' && item.paramId === inputId);
				if (item) return item;
			}
		}
	}
	return null;
}

export interface OutputUpdateOptions {
	outputs?: Record<string, unknown>;
	fileOutputs?: Record<string, unknown>;
	schema: UISchema | null;
}

/**
 * Process output updates from Grasshopper solve results.
 * Filters outputs to only include those defined in the schema and merges with file outputs.
 */
export function processOutputUpdate(options: OutputUpdateOptions): Record<string, unknown> {
	// Only include outputs that exist in schema
	const outputUpdates = Object.fromEntries(
		Object.entries(options.outputs || {}).filter(([paramId]) =>
			options.schema?.outputs.some((o) => o.id === paramId)
		)
	);

	// File outputs are always included
	const fileOutputUpdates = options.fileOutputs || {};
	return { ...outputUpdates, ...fileOutputUpdates };
}

interface ParameterUpdate {
	id: string;
	nickname?: string;
	description?: string;
	minimum?: number;
	maximum?: number;
	stepSize?: number;
}

/**
 * Update schema metadata (nicknames, descriptions, constraints) from Grasshopper parameter changes.
 * Mutates the schema in place and returns count of updated parameters.
 *
 * Updates:
 * - Input/output nicknames and descriptions
 * - Widget config constraints (minimum, maximum, stepSize)
 */
export function updateParameterMetadata(
	schema: UISchema,
	changedParams: ParameterUpdate[]
): { updated: number; names: string[] } {
	let updatedCount = 0;
	const updatedNames: string[] = [];

	const processGroup = (group: { items: LayoutItem[] }, updated: ParameterUpdate) => {
		group.items?.forEach((layoutItem) => {
			if (
				layoutItem.type !== 'linebreak' &&
				layoutItem.paramId === updated.id &&
				isInputLayoutItem(layoutItem) &&
				isNumberInputLayoutItem(layoutItem)
			) {
				const config = layoutItem.config as NumberWidgetConfig;
				let configChanged = false;

				// Update numeric constraints if present
				if (updated.minimum !== undefined && config.minimum !== updated.minimum) {
					config.minimum = updated.minimum;
					configChanged = true;
				}
				if (updated.maximum !== undefined && config.maximum !== updated.maximum) {
					config.maximum = updated.maximum;
					configChanged = true;
				}
				if (updated.stepSize !== undefined && config.stepSize !== updated.stepSize) {
					config.stepSize = updated.stepSize;
					configChanged = true;
				}

				if (configChanged) {
					layoutItem.config = config;
				}
			}
		});
	};

	changedParams.forEach((updated) => {
		// Update input metadata
		const input = schema.inputs.find((inp) => inp.id === updated.id);
		if (input) {
			let changed = false;

			if (updated.nickname !== undefined && input.nickname !== updated.nickname) {
				input.nickname = updated.nickname;
				changed = true;
			}
			if (updated.description !== undefined && input.description !== updated.description) {
				input.description = updated.description;
				changed = true;
			}

			if (changed) {
				updatedCount++;
				updatedNames.push(input.nickname);
			}

			// Update layout item configs
			if (schema.layout.type === 'tabbed') {
				schema.layout.tabs.forEach((tab) => tab.groups?.forEach((g) => processGroup(g, updated)));
			} else if (schema.layout.type === 'flat') {
				schema.layout.groups.forEach((g) => processGroup(g, updated));
			}
		}

		// Update output metadata
		const output = schema.outputs.find((out) => out.id === updated.id);
		if (output) {
			let changed = false;

			if (updated.nickname !== undefined && output.nickname !== updated.nickname) {
				output.nickname = updated.nickname;
				changed = true;
			}
			if (updated.description !== undefined && output.description !== updated.description) {
				output.description = updated.description;
				changed = true;
			}

			if (changed) {
				updatedCount++;
				updatedNames.push(output.nickname);
			}
		}
	});

	return { updated: updatedCount, names: updatedNames };
}

/**
 * Remove parameters from values object by their IDs.
 * Returns a new object without mutating the original.
 */
export function removeParametersFromValues(
	values: Record<string, unknown>,
	removedIds: string[]
): Record<string, unknown> {
	const newValues = { ...values };
	removedIds.forEach((id) => delete newValues[id]);
	return newValues;
}
