import type {
  UISchema,
  AvailableInput,
  AvailableOutput,
  InputParamSchema,
  TabConfig,
  GroupConfig,
  LayoutItem,
  InputLayoutItem,
  OutputLayoutItem,
} from '$lib/types/generated';
import { mapParamTypeToWidgetType, createDefaultWidgetConfig } from './widget-config';
import { toast } from '$lib/components/ui/sonner';

export function isItemUsedInLayout(schema: UISchema | null, paramId: string): boolean {
  return (
    schema?.layout?.tabs?.some((t) =>
      t.groups.some((g) => g.items.some((i) => i.paramId === paramId))
    ) ?? false
  );
}

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

export function createLayoutItem(
  paramId: string,
  displayName: string,
  itemType: 'input' | 'output',
  itemCount: number,
  availableInputs: AvailableInput[],
  widgetType?: string,
  paramType?: string
): LayoutItem {
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

  const fullParam =
    itemType === 'input' ? availableInputs.find((p) => p.id === paramId) : undefined;

  const config =
    itemType === 'input' && paramType
      ? createDefaultWidgetConfig(
          resolvedWidgetType as any,
          fullParam || ({ type: paramType } as any),
          'input'
        )
      : itemType === 'output' && paramType
        ? createDefaultWidgetConfig(resolvedWidgetType as any, { type: paramType } as any, 'output')
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

  const newItems = [...group.items];
  if (dropPosition === 'before') {
    newItems.splice(targetIndex, 0, item);
  } else {
    newItems.splice(targetIndex + 1, 0, item);
  }
  group.items = newItems;
}

export function handleItemDrop(
  schema: UISchema,
  group: GroupConfig,
  paramId: string,
  displayName: string,
  itemType: 'input' | 'output',
  availableParams: AvailableInput[],
  paramType?: string,
  widgetType?: string,
  targetItem?: LayoutItem,
  dropPosition?: 'before' | 'after',
  outputType?: 'text' | 'number' | 'file'
) {
  if (group.items.some((i) => i.paramId === paramId)) {
    const itemTypeLabel =
      widgetType === 'file' ? 'file component' : itemType === 'input' ? 'parameter' : 'output';
    toast.warning(`This ${itemTypeLabel} is already in this group`);
    return;
  }

  if (itemType === 'input') {
    const inputExists = schema.inputs.some((i) => i.id === paramId);
    if (!inputExists) {
      schema.inputs = [
        ...schema.inputs,
        {
          id: paramId,
          nickname: displayName,
          paramType: (paramType as any) || 'generic',
          description: '',
        } as InputParamSchema,
      ];
    }
  } else {
    const outputExists = schema.outputs.some((o) => o.id === paramId);
    if (!outputExists) {
      const finalOutputType = outputType || 'text';

      schema.outputs = [
        ...schema.outputs,
        {
          id: paramId,
          nickname: displayName,
          type: finalOutputType,
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

export function removeGroup(schema: UISchema, tabId: string, groupId: string) {
  if (!schema.layout.tabs) return;

  const tab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tab.groups = tab.groups.filter((g) => g.id !== groupId);
  schema.layout.tabs = [...schema.layout.tabs];
}

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

export function reorderTabs(schema: UISchema, fromIndex: number, toIndex: number) {
  if (!schema.layout.tabs) return;

  const tabs = [...schema.layout.tabs];
  const [movedTab] = tabs.splice(fromIndex, 1);
  tabs.splice(toIndex, 0, movedTab);

  tabs.forEach((tab, index) => {
    tab.order = index;
  });

  schema.layout.tabs = tabs;
}

export function reorderGroups(schema: UISchema, tabId: string, fromIndex: number, toIndex: number) {
  if (!schema.layout.tabs) return;

  const tab = schema.layout.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const groups = [...tab.groups];
  const [movedGroup] = groups.splice(fromIndex, 1);
  groups.splice(toIndex, 0, movedGroup);

  groups.forEach((group, index) => {
    group.order = index;
  });

  tab.groups = groups;
  schema.layout.tabs = [...schema.layout.tabs];
}

export function batchSetNumberWidgetType(
  schema: UISchema,
  renderAsSlider: boolean
): { changed: number } {
  let count = 0;

  if (!schema.layout.tabs) {
    return { changed: count };
  }

  schema.layout.tabs.forEach((tab) => {
    tab.groups.forEach((group) => {
      group.items.forEach((item) => {
        // Only process input number widgets
        if (item.type === 'input' && item.widgetType === 'number') {
          if (item.config && 'renderAsSlider' in item.config) {
            item.config.renderAsSlider = renderAsSlider;
            count++;
          }
        }
      });
    });
  });

  return { changed: count };
}
