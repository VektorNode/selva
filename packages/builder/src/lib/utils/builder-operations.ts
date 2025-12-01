import type {
  UISchema,
  AvailableParameter,
  AvailableOutput,
  InputParamSchema,
  TabConfig,
  GroupConfig,
  LayoutItem,
  InputLayoutItem,
  OutputLayoutItem,
} from '$lib/types/generated';
import { mapParamTypeToWidgetType, createDefaultWidgetConfig } from '$lib/utils/widget-config';
import { toast } from '$lib/components/ui/sonner';

/**
 * Check if an item is used anywhere in the layout
 */
export function isItemUsedInLayout(schema: UISchema | null, paramId: string): boolean {
  return (
    schema?.layout?.tabs?.some((t) =>
      t.groups.some((g) => g.items.some((i) => i.paramId === paramId))
    ) ?? false
  );
}

/**
 * Remove a parameter from schema if it's not used anywhere in the layout
 */
export function removeItemIfOrphaned(
  schema: UISchema,
  paramId: string,
  itemType: 'input' | 'output'
) {
  const isUsed = isItemUsedInLayout(schema, paramId);
  if (!isUsed) {
    if (itemType === 'input') {
      schema.inputs = schema.inputs.filter((i) => i.id !== paramId);
    } else if (itemType === 'output') {
      schema.outputs = schema.outputs.filter((o) => o.id !== paramId);
    }
  }
}

/**
 * Create a layout item for either a parameter or downloadable component
 */
export function createLayoutItem(
  paramId: string,
  displayName: string,
  itemType: 'input' | 'output',
  itemCount: number,
  availableParams: AvailableParameter[],
  widgetType?: string,
  paramType?: string
): LayoutItem {
  // Determine widget type
  let resolvedWidgetType = widgetType;
  if (!resolvedWidgetType) {
    if (itemType === 'input' && paramType) {
      resolvedWidgetType = mapParamTypeToWidgetType(paramType as any, 'input');
    } else if (itemType === 'output' && paramType) {
      resolvedWidgetType = mapParamTypeToWidgetType(paramType as any, 'output');
    } else {
      resolvedWidgetType = itemType === 'input' ? 'number' : 'text';
    }
  }

  // Look up the full parameter to get all metadata (including options for ValueList)
  const fullParam =
    itemType === 'input' ? availableParams.find((p) => p.id === paramId) : undefined;

  // Get config if needed
  const config =
    itemType === 'input' && paramType
      ? createDefaultWidgetConfig(
        resolvedWidgetType as any,
        fullParam || ({ paramType } as any),
        'input'
      )
      : itemType === 'output' && paramType
        ? createDefaultWidgetConfig(resolvedWidgetType as any, { paramType } as any, 'output')
        : {};

  return itemType === 'input'
    ? ({
      id: crypto.randomUUID().substring(0, 8),
      paramId,
      type: 'input',
      displayName,
      widgetType: resolvedWidgetType as any,
      order: itemCount,
      span: 1,
      config,
    } as InputLayoutItem)
    : ({
      id: crypto.randomUUID().substring(0, 8),
      paramId,
      type: 'output',
      displayName,
      widgetType: resolvedWidgetType as any,
      order: itemCount,
      span: 1,
      config: itemType === 'output' && resolvedWidgetType === 'file' ? {} : config,
    } as OutputLayoutItem);
}

/**
 * Insert an item at the specified position in a group, or append if no position
 */
export function insertLayoutItem(
  group: GroupConfig,
  item: LayoutItem,
  targetItem?: LayoutItem,
  dropPosition?: 'before' | 'after'
) {
  if (!targetItem || !dropPosition) {
    group.items = [...group.items, item];
    return;
  }

  const targetIndex = group.items.findIndex((i) => i.id === targetItem.id);
  if (targetIndex < 0) {
    group.items = [...group.items, item];
    return;
  }

  // Create new array to maintain reactivity
  const newItems = [...group.items];
  if (dropPosition === 'before') {
    newItems.splice(targetIndex, 0, item);
  } else {
    newItems.splice(targetIndex + 1, 0, item);
  }
  group.items = newItems;
}

/**
 * Unified handler for dropping parameters and downloadables
 */
export function handleItemDrop(
  schema: UISchema,
  group: GroupConfig,
  paramId: string,
  displayName: string,
  itemType: 'input' | 'output',
  availableParams: AvailableParameter[],
  paramType?: string,
  widgetType?: string,
  targetItem?: LayoutItem,
  dropPosition?: 'before' | 'after',
  outputType?: 'Print' | 'File'
) {
  // Check if already in this group
  if (group.items.some((i) => i.paramId === paramId)) {
    const itemTypeLabel =
      widgetType === 'file' ? 'file component' : itemType === 'input' ? 'parameter' : 'output';
    toast.warning(`This ${itemTypeLabel} is already in this group`);
    return;
  }

  // Ensure it's in schema
  if (itemType === 'input') {
    const inputExists = schema.inputs.some((i) => i.id === paramId);
    if (!inputExists) {
      schema.inputs = [
        ...schema.inputs,
        {
          id: paramId,
          nickname: displayName,
          paramType: (paramType as any) || 'Generic',
          description: '',
        } as InputParamSchema,
      ];
    }
  } else {
    const outputExists = schema.outputs.some((o) => o.id === paramId);
    if (!outputExists) {
      const finalOutputType = outputType || 'print';

      schema.outputs = [
        ...schema.outputs,
        {
          id: paramId,
          nickname: displayName,
          outputType: finalOutputType,
          description: '',
        } as AvailableOutput,
      ];
    }
  }

  const newItem = createLayoutItem(
    paramId,
    displayName,
    itemType,
    group.items.length,
    availableParams,
    widgetType,
    paramType
  );
  insertLayoutItem(group, newItem, targetItem, dropPosition);
}

/**
 * Handle reordering items between groups
 */
export function handleGroupItemDrop(
  schema: UISchema,
  tabId: string,
  groupId: string,
  sourceTabId: string,
  sourceGroupId: string,
  sourceItem: LayoutItem,
  targetItem?: LayoutItem,
  dropPosition?: 'before' | 'after'
) {
  if (!schema?.layout.tabs) return;

  const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
  const targetTab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!sourceTab || !targetTab) return;

  const sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
  const targetGroup = targetTab.groups.find((g) => g.id === groupId);
  if (!sourceGroup || !targetGroup) return;

  const sourceIndex = sourceGroup.items.findIndex((i) => i.id === sourceItem.id);
  if (sourceIndex < 0) return;

  const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);
  insertLayoutItem(targetGroup, movedItem, targetItem, dropPosition);
}

/**
 * Add a new tab to the schema
 */
export function addTab(schema: UISchema): string {
  if (!schema.layout.tabs) return '';

  const newTab: TabConfig = {
    id: crypto.randomUUID().substring(0, 8),
    label: `Tab ${schema.layout.tabs.length + 1}`,
    icon: '',
    order: schema.layout.tabs.length,
    groups: [],
  };

  schema.layout.tabs = [...schema.layout.tabs, newTab];
  return newTab.id;
}

/**
 * Remove a tab from the schema
 */
export function removeTab(schema: UISchema, tabId: string) {
  if (!schema.layout.tabs) return;

  const tab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tab.groups.forEach((group) => {
    group.items.forEach((item) => {
      removeItemIfOrphaned(schema, item.paramId, item.type);
    });
  });

  schema.layout.tabs = schema.layout.tabs.filter((t) => t.id !== tabId);
}

/**
 * Add a new group to a tab
 */
export function addGroup(schema: UISchema, tabId: string) {
  if (!schema.layout.tabs) return;

  const tab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const newGroup: GroupConfig = {
    id: crypto.randomUUID().substring(0, 8),
    label: `Group ${tab.groups.length + 1}`,
    description: '',
    order: tab.groups.length,
    collapsed: false,
    columns: 1,
    items: [],
  };

  tab.groups = [...tab.groups, newGroup];
}

/**
 * Remove a group from a tab
 */
export function removeGroup(schema: UISchema, tabId: string, groupId: string) {
  if (!schema.layout.tabs) return;

  const tab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tab.groups = tab.groups.filter((g) => g.id !== groupId);
  schema.layout.tabs = [...schema.layout.tabs];
}

/**
 * Remove an item from a group
 */
export function removeItem(schema: UISchema, tabId: string, groupId: string, itemId: string) {
  if (!schema.layout.tabs) return;

  const tab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const group = tab.groups.find((g) => g.id === groupId);
  if (!group) return;

  const item = group.items.find((i) => i.id === itemId);
  group.items = group.items.filter((i) => i.id !== itemId);

  if (item) {
    removeItemIfOrphaned(schema, item.paramId, item.type);
  }
}

/**
 * Reorder tabs
 */
export function reorderTabs(schema: UISchema, fromIndex: number, toIndex: number) {
  if (!schema.layout.tabs) return;

  const tabs = [...schema.layout.tabs];
  const [movedTab] = tabs.splice(fromIndex, 1);
  tabs.splice(toIndex, 0, movedTab);

  // Update order property for each tab
  tabs.forEach((tab, index) => {
    tab.order = index;
  });

  schema.layout.tabs = tabs;
}
