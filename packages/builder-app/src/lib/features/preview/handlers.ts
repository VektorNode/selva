import type {
	UISchema,
	DiscoveredParameters,
	LayoutItem,
	InputLayoutItem,
	InputNumberLayoutItem,
	NumberWidgetConfig
} from '@selvajs/schemas';
import { getDefaultValue } from '@selvajs/ui';

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

export function initializeValues(options: InitializeValuesOptions): Record<string, unknown> {
	const values: Record<string, unknown> = {};

	options.schema.inputs.forEach((input) => {
		const availableParam = options.availableParams?.inputs?.find((p) => p.id === input.id);
		const defaultValue =
			availableParam?.default !== null && availableParam?.default !== undefined
				? availableParam.default
				: getDefaultValue(input.paramType);

		values[input.id] = defaultValue;
	});

	options.schema.outputs.forEach((output) => {
		values[output.id] = null;
	});

	if (options.currentValues && Object.keys(options.currentValues).length > 0) {
		Object.assign(values, options.currentValues);
	}

	return values;
}

export interface OutputUpdateOptions {
	outputs?: Record<string, unknown>;
	fileOutputs?: Record<string, unknown>;
	schema: UISchema | null;
}

export function processOutputUpdate(options: OutputUpdateOptions): Record<string, unknown> {
	const outputUpdates = Object.fromEntries(
		Object.entries(options.outputs || {}).filter(([paramId]) =>
			options.schema?.outputs.some((o) => o.id === paramId)
		)
	);

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

			if (schema.layout.type === 'tabbed') {
				schema.layout.tabs.forEach((tab) => tab.groups?.forEach((g) => processGroup(g, updated)));
			} else if (schema.layout.type === 'flat') {
				schema.layout.groups.forEach((g) => processGroup(g, updated));
			}
		}

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

export function removeParametersFromValues(
	values: Record<string, unknown>,
	removedIds: string[]
): Record<string, unknown> {
	const newValues = { ...values };
	removedIds.forEach((id) => delete newValues[id]);
	return newValues;
}
