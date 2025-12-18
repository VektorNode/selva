import type {
  DiscoveredInput,
  GrasshopperParamType,
  NumberWidgetConfig,
  TextWidgetConfig,
  DropdownWidgetConfig,
  CheckboxWidgetConfig,
  InputNumberLayoutItem,
  InputTextLayoutItem,
  InputDropdownLayoutItem,
  InputCheckboxLayoutItem,
  OutputTextLayoutItem,
  OutputNumberLayoutItem,
  OutputFileLayoutItem,
} from '@selva/shared';

export type InputWidgetType =
  | InputNumberLayoutItem['widgetType']
  | InputTextLayoutItem['widgetType']
  | InputDropdownLayoutItem['widgetType']
  | InputCheckboxLayoutItem['widgetType'];

export type OutputWidgetType =
  | OutputTextLayoutItem['widgetType']
  | OutputNumberLayoutItem['widgetType']
  | OutputFileLayoutItem['widgetType'];

export type WidgetType = InputWidgetType | OutputWidgetType;

export type InputWidgetConfig =
  | NumberWidgetConfig
  | TextWidgetConfig
  | DropdownWidgetConfig
  | CheckboxWidgetConfig;

export type OutputWidgetConfig = Record<string, never>;

export type WidgetConfig = InputWidgetConfig | OutputWidgetConfig;

export function mapParamTypeToWidgetType(
  paramType: GrasshopperParamType,
  category: 'input' | 'output'
): WidgetType {
  if (category === 'output') {
    switch (paramType) {
      case 'number':
      case 'integer':
        return 'number';
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
          renderAsSlider: true,
        };
        return config;
      }

      case 'dropdown': {
        const config: DropdownWidgetConfig = {
          options: param.options || {},
        };
        return config;
      }

      case 'text': {
        const config: TextWidgetConfig = {
          placeholder: `Enter ${param.nickname}`,
        };
        return config;
      }

      case 'checkbox': {
        const config: CheckboxWidgetConfig = {};
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

      case 'dropdown':
      case 'checkbox':
        throw new Error(`Widget type '${widgetType}' is not valid for output parameters`);

      default: {
        const _exhaustive: never = widgetType;
        throw new Error(`Unsupported widget type: ${_exhaustive}`);
      }
    }
  }
}
