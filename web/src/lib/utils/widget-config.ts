import type { AvailableParameter, GrasshopperParamType } from '$lib/types/generated';

/**
 * Map Grasshopper parameter types to default UI widget types
 */
export function mapParamTypeToWidgetType(
	paramType: GrasshopperParamType,
	category: 'input' | 'output'
): string {
	if (category === 'output') {
		// Output widgets
		switch (paramType) {
			case 'Number':
			case 'Integer':
				return 'number';
			default:
				return 'text';
		}
	} else {
		// Input widgets
		switch (paramType) {
			case 'Number':
			case 'Integer':
				return 'number';
			case 'Boolean':
				return 'checkbox';
			case 'Text':
				return 'text';
			default:
				return 'text';
		}
	}
}

/**
 * Create default widget configuration based on parameter type
 */
export function createDefaultWidgetConfig(
	widgetType: string,
	param: AvailableParameter,
	category: 'input' | 'output'
): any {
	const config: any = {};

	if (category === 'input') {
		switch (widgetType) {
			case 'number':
				config.min = param.minimum ?? 0;
				config.max = param.maximum ?? 100;
				config.step = param.paramType === 'Integer' ? 1 : (param.stepSize ?? 0.1);
				config.renderAsSlider = true; // Default to slider rendering for numeric inputs
				break;

			case 'dropdown':
				config.options = [];
				break;

			case 'text':
				config.placeholder = `Enter ${param.name}`;
				break;

			case 'checkbox':
				// No additional config needed
				break;

			case 'color':
				config.format = 'hex';
				break;
		}
	} else {
		// Output config
		switch (widgetType) {
			case '3d-viewer':
				config.showGrid = true;
				config.showAxes = true;
				break;

			case 'text':
			case 'number':
				// No additional config needed
				break;
		}
	}

	return config;
}
