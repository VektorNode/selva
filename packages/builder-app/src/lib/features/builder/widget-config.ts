import type {
	DiscoveredInput,
	GrasshopperParamType,
	NumberWidgetConfig,
	TextWidgetConfig,
	DropdownWidgetConfig,
	CheckboxWidgetConfig,
	FileInputWidgetConfig,
	ColorWidgetConfig,
	ChartWidgetConfig,
	ImageWidgetConfig,
	InputNumberLayoutItem,
	InputTextLayoutItem,
	InputDropdownLayoutItem,
	InputCheckboxLayoutItem,
	InputFileLayoutItem,
	InputColorLayoutItem,
	OutputTextLayoutItem,
	OutputNumberLayoutItem,
	OutputFileLayoutItem,
	OutputChartLayoutItem,
	OutputImageLayoutItem
} from '@selvajs/schemas';
import { ACCEPTED_FILE_FORMATS } from '@selvajs/schemas';

// File input configuration constants
export const FILE_INPUT_MODES = ['upload', 'url'] as const;
export type FileInputMode = (typeof FILE_INPUT_MODES)[number];

// Re-export ACCEPTED_FILE_FORMATS for backward compatibility
export { ACCEPTED_FILE_FORMATS };

export type InputWidgetType =
	| InputNumberLayoutItem['widgetType']
	| InputTextLayoutItem['widgetType']
	| InputDropdownLayoutItem['widgetType']
	| InputCheckboxLayoutItem['widgetType']
	| InputFileLayoutItem['widgetType']
	| InputColorLayoutItem['widgetType'];

export type OutputWidgetType =
	| OutputTextLayoutItem['widgetType']
	| OutputNumberLayoutItem['widgetType']
	| OutputFileLayoutItem['widgetType']
	| OutputChartLayoutItem['widgetType']
	| OutputImageLayoutItem['widgetType'];

export type WidgetType = InputWidgetType | OutputWidgetType;

export type InputWidgetConfig =
	| NumberWidgetConfig
	| TextWidgetConfig
	| DropdownWidgetConfig
	| CheckboxWidgetConfig
	| FileInputWidgetConfig
	| ColorWidgetConfig;

export type OutputWidgetConfig = ChartWidgetConfig | ImageWidgetConfig | Record<string, never>;

export type WidgetConfig = InputWidgetConfig | OutputWidgetConfig;

export function mapParamTypeToWidgetType(
	paramType: GrasshopperParamType | 'chart' | 'file',
	category: 'input' | 'output'
): WidgetType {
	if (category === 'output') {
		switch (paramType) {
			case 'number':
			case 'integer':
				return 'number';
			case 'chart':
				return 'chart';
			default:
				return 'text';
		}
	} else {
		switch (paramType) {
			case 'number':
			case 'integer':
				return 'number';
			case 'boolean':
				return 'checkbox';
			case 'text':
				return 'text';
			case 'valueList':
				return 'dropdown';
			case 'file':
				return 'file';
			case 'color':
				return 'color';
			default:
				return 'text';
		}
	}
}

export function createDefaultWidgetConfig(
	widgetType: WidgetType,
	param: DiscoveredInput,
	category: 'input' | 'output'
): WidgetConfig {
	if (category === 'input') {
		switch (widgetType) {
			case 'number': {
				const config: NumberWidgetConfig = {
					minimum: param.minimum ?? 0,
					maximum: param.maximum ?? 100,
					stepSize: param.type === 'integer' ? 1 : (param.stepSize ?? 0.1),
					renderAsSlider: true
				};
				return config;
			}

			case 'dropdown': {
				const config: DropdownWidgetConfig = {
					options: param.options || {}
				};
				return config;
			}

			case 'text': {
				const config: TextWidgetConfig = {
					placeholder: `Enter ${param.nickname}`,
					maxLength: undefined,
					pattern: undefined,
					customErrorMessage: undefined
				};
				return config;
			}

			case 'checkbox': {
				const config: CheckboxWidgetConfig = {};
				return config;
			}

			case 'file': {
				const config: FileInputWidgetConfig = {
					acceptedFormats: [...ACCEPTED_FILE_FORMATS],
					defaultInputMode: 'upload'
				};
				return config;
			}

			case 'color': {
				const config: ColorWidgetConfig = {};
				return config;
			}

			default: {
				const _exhaustive: never = widgetType as never;
				throw new Error(`Unsupported input widget type: ${_exhaustive}`);
			}
		}
	} else {
		switch (widgetType) {
			case 'text':
			case 'number':
			case 'file':
				return {};

			case 'chart': {
				const config: ChartWidgetConfig = {};
				return config;
			}

			case 'image': {
				const config: ImageWidgetConfig = {
					allowDownload: true,
					allowFullscreen: true,
					fitMode: 'contain'
				};
				return config;
			}

			case 'dropdown':
			case 'checkbox':
			case 'color':
				throw new Error(`Widget type '${widgetType}' is not valid for output parameters`);

			default: {
				const _exhaustive: never = widgetType;
				throw new Error(`Unsupported widget type: ${_exhaustive}`);
			}
		}
	}
}
