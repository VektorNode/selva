import type {
  AvailableParameter,
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
} from '$lib/types/generated';

// Widget type literals extracted from schema layout items
export type InputWidgetType =
  | InputNumberLayoutItem['widgetType']
  | InputTextLayoutItem['widgetType']
  | InputDropdownLayoutItem['widgetType']
  | InputCheckboxLayoutItem['widgetType'];

export type OutputWidgetType =
  | OutputTextLayoutItem['widgetType']
  | OutputNumberLayoutItem['widgetType'];

export type WidgetType = InputWidgetType | OutputWidgetType;

// Union type for all widget configs (from generated schema)
export type InputWidgetConfig =
  | NumberWidgetConfig
  | TextWidgetConfig
  | DropdownWidgetConfig
  | CheckboxWidgetConfig;

export type OutputWidgetConfig = Record<string, never>;

export type WidgetConfig = InputWidgetConfig | OutputWidgetConfig;

/**
 * Map Grasshopper parameter types to default UI widget types
 */
export function mapParamTypeToWidgetType(
  paramType: GrasshopperParamType,
  category: 'input' | 'output'
): WidgetType {
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
      case 'ValueList':
        return 'dropdown';
      default:
        return 'text';
    }
  }
}

/**
 * Create default widget configuration based on parameter type
 */
export function createDefaultWidgetConfig(
  widgetType: WidgetType,
  param: AvailableParameter,
  category: 'input' | 'output'
): WidgetConfig {

  if (category === 'input') {
    switch (widgetType) {
      case 'number': {
        const config: NumberWidgetConfig = {
          minimum: param.minimum ?? 0,
          maximum: param.maximum ?? 100,
          stepSize: param.paramType === 'Integer' ? 1 : (param.stepSize ?? 0.1),
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
          placeholder: `Enter ${param.name}`,
        };
        return config;
      }

      case 'checkbox': {
        const config: CheckboxWidgetConfig = {};
        return config;
      }

      default: {
        // Exhaustiveness check - TypeScript will error if we miss a case
        const _exhaustive: never = widgetType;
        throw new Error(`Unsupported widget type: ${_exhaustive}`);
      }
    }
  } else {
    // Output config
    switch (widgetType) {
      case 'text':
      case 'number':
        return {};

      case 'dropdown':
      case 'checkbox':
        // Input widget types used in output context
        throw new Error(`Widget type '${widgetType}' is not valid for output parameters`);

      default: {
        // Exhaustiveness check
        const _exhaustive: never = widgetType;
        throw new Error(`Unsupported widget type: ${_exhaustive}`);
      }
    }
  }
}
