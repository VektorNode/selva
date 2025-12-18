import type { UISchema, DiscoveredParameters } from '$lib/types/generated';
import { getDefaultValue } from '$lib/utils/utils-shared';

export interface InitializeValuesOptions {
	schema: UISchema;
	availableParams?: DiscoveredParameters;
	currentValues?: Record<string, unknown>;
}

export function initializeValues(options: InitializeValuesOptions): Record<string, unknown> {
	const values: Record<string, unknown> = {};

	options.schema.inputs.forEach((input: any) => {
		const availableParam = options.availableParams?.inputs?.find((p) => p.id === input.id);
		const defaultValue =
			availableParam?.default !== null && availableParam?.default !== undefined
				? availableParam.default
				: getDefaultValue(input.paramType);

		values[input.id] = defaultValue;
	});

	options.schema.outputs.forEach((output: any) => {
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

export function updateParameterMetadata(
	schema: UISchema,
	changedParams: any[]
): { updated: number; names: string[] } {
	let updatedCount = 0;
	const updatedNames: string[] = [];

	changedParams.forEach((updated: any) => {
		const inputIndex = schema.inputs.findIndex((inp) => inp.id === updated.id);
		if (inputIndex !== -1) {
			const input = schema.inputs[inputIndex];
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
				console.log(`[Preview] Updated input metadata: ${input.nickname}`);
			}

			const processGroup = (group: any) => {
				group.items?.forEach((layoutItem: any) => {
					if (layoutItem.paramId === updated.id && layoutItem.type === 'input') {
						const config = layoutItem.config || {};

						if (updated.minimum !== undefined && config.minimum !== updated.minimum) {
							config.minimum = updated.minimum;
							changed = true;
						}
						if (updated.maximum !== undefined && config.maximum !== updated.maximum) {
							config.maximum = updated.maximum;
							changed = true;
						}
						if (updated.stepSize !== undefined && config.stepSize !== updated.stepSize) {
							config.stepSize = updated.stepSize;
							changed = true;
						}

						layoutItem.config = config;
					}
				});
			};

			if (schema.layout.type === 'tabbed') {
				schema.layout.tabs.forEach((tab) => {
					tab.groups?.forEach(processGroup);
				});
			} else if (schema.layout.type === 'flat') {
				schema.layout.groups.forEach(processGroup);
			}
		}

		const outputIndex = schema.outputs.findIndex((out) => out.id === updated.id);
		if (outputIndex !== -1) {
			const output = schema.outputs[outputIndex];
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
				console.log(`[Preview] Updated output metadata: ${output.nickname}`);
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
	removedIds.forEach((id) => {
		delete newValues[id];
	});
	return newValues;
}
