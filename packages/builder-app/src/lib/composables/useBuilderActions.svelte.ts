import { toast } from '@selva/ui-shared';
import type { DiscoveredInput, DiscoveredOutput, GroupConfig } from '@selva/ui-shared';
import {
  handleItemDrop,
  handleGroupItemDrop,
  addTab,
  removeTab,
  addGroup,
  removeGroup,
  removeItem,
  reorderTabs,
  reorderGroups,
  batchSetNumberWidgetType,
} from '$lib/features/builder/operations';
import type { useBuilderState } from './useBuilderState.svelte';

export function useBuilderActions(getBuilderState: () => ReturnType<typeof useBuilderState> | null) {

  function ensureSchema() {
    const builderState = getBuilderState();
    if (!builderState?.state.schema) return null;
    return { builderState, schema: builderState.state.schema };
  }

  function onParameterDrop(tabId: string, groupId: string, event: CustomEvent) {
    const context = ensureSchema();
    if (!context) return;
    const { builderState, schema } = context;

    const { dropType, data, targetItem, dropPosition, sourceTabId, sourceGroupId, sourceItem } =
      event.detail;

    let group: GroupConfig | undefined;

    if (schema.layout.type === 'tabbed') {
      const tab = schema.layout.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      group = tab.groups.find((g) => g.id === groupId);
    } else if (schema.layout.type === 'flat') {
      group = schema.layout.groups.find((g) => g.id === groupId);
    }

    if (!group) return;

    // Handle moving items within layout
    if (dropType === 'group-item') {
      handleGroupItemDrop(
        schema,
        tabId,
        groupId,
        sourceTabId,
        sourceGroupId,
        sourceItem,
        targetItem,
        dropPosition
      );
      return;
    }

    // Handle dropping inputs or outputs
    if (dropType === 'input') {
      const param = data as DiscoveredInput;
      handleItemDrop(
        schema,
        group,
        param.id,
        param.nickname || 'unnamed',
        'input',
        builderState.state.availableInputs,
        param.type,
        undefined,
        targetItem,
        dropPosition
      );
    } else if (dropType === 'output') {
      const output = data as DiscoveredOutput;
      const widgetType = output.type === 'file' ? 'file' : 'text';
      handleItemDrop(
        schema,
        group,
        output.id,
        output.nickname,
        'output',
        builderState.state.availableInputs,
        undefined,
        widgetType,
        targetItem,
        dropPosition,
        output.type
      );
    }
  }

  function onReorder(event: CustomEvent) {
    const context = ensureSchema();
    if (!context) return;
    const { schema } = context;

    const {
      sourceItem,
      sourceTabId,
      sourceGroupId,
      targetItem,
      targetTabId,
      targetGroupId,
      dropPosition,
    } = event.detail;

    if (sourceItem.id === targetItem.id) return;

    let sourceGroup: GroupConfig | undefined;
    let targetGroup: GroupConfig | undefined;

    if (schema.layout.type === 'tabbed') {
      const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
      const targetTab = schema.layout.tabs.find((t) => t.id === targetTabId);
      if (!sourceTab || !targetTab) return;

      sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
      targetGroup = targetTab.groups.find((g) => g.id === targetGroupId);
    } else if (schema.layout.type === 'flat') {
      sourceGroup = schema.layout.groups.find((g) => g.id === sourceGroupId);
      targetGroup = schema.layout.groups.find((g) => g.id === targetGroupId);
    }

    if (!sourceGroup || !targetGroup) return;

    const sourceIndex = sourceGroup.items.findIndex((i) => i.id === sourceItem.id);
    if (sourceIndex < 0) return;

    // Store the target index BEFORE removing the source item
    let targetIndex = targetGroup.items.findIndex((i) => i.id === targetItem.id);

    const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);

    if (targetIndex < 0) {
      targetGroup.items.push(movedItem);
    } else {
      // When moving within the same group, we need to account for the removed item
      const isSameGroup = sourceGroup === targetGroup;

      if (dropPosition === 'before') {
        // Adjust target index if we removed an item before it
        if (isSameGroup && sourceIndex < targetIndex) {
          targetIndex--;
        }
        targetGroup.items.splice(targetIndex, 0, movedItem);
      } else {
        // dropPosition === 'after'
        // Adjust target index only if we removed an item BEFORE the target
        if (isSameGroup && sourceIndex < targetIndex) {
          targetIndex--;
        }
        targetGroup.items.splice(targetIndex + 1, 0, movedItem);
      }
    }
  }

  function onAddToGroup(
    tabId: string,
    groupId: string,
    item: DiscoveredInput | DiscoveredOutput
  ) {
    const context = ensureSchema();
    if (!context) return;
    const { builderState, schema } = context;

    let group: GroupConfig | undefined;
    let tabLabel = '';

    if (schema.layout.type === 'tabbed') {
      const tab = schema.layout.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      tabLabel = tab.label;
      group = tab.groups.find((g) => g.id === groupId);
    } else if (schema.layout.type === 'flat') {
      group = schema.layout.groups.find((g) => g.id === groupId);
      tabLabel = 'Layout';
    }

    if (!group) return;

    const itemType = 'name' in item ? 'input' : 'output';
    const paramType = 'name' in item ? item.type : undefined;
    const widgetType = 'name' in item ? undefined : item.type === 'file' ? 'file' : 'text';
    const outputType = 'name' in item ? undefined : item.type;

    handleItemDrop(
      schema,
      group,
      item.id,
      item.nickname || ('name' in item ? item.name : 'Unknown'),
      itemType,
      builderState.state.availableInputs,
      paramType,
      widgetType,
      undefined,
      undefined,
      outputType
    );

    toast.success(`Added to ${tabLabel} / ${group.label}`);
  }

  function onAddToNewGroup(path: string, item: DiscoveredInput | DiscoveredOutput) {
    const context = ensureSchema();
    if (!context) return;
    const { builderState, schema } = context;

    const parts = path.split('/').map((p) => p.trim());
    let tabId: string = '';
    let groupLabel: string;

    if (schema.layout.type === 'tabbed') {
      if (parts.length === 2) {
        const [tabLabel, grpLabel] = parts;
        let tab = schema.layout.tabs.find((t) => t.label.toLowerCase() === tabLabel.toLowerCase());

        if (!tab) {
          const newTabId = addTab(schema);
          tab = schema.layout.tabs.find((t) => t.id === newTabId);
          if (tab) {
            tab.label = tabLabel;
            // Auto-select the newly created tab
            builderState.state.activeTabId = newTabId;
            toast.success(`Created new tab: ${tabLabel}`);
          }
        }

        if (!tab) return;
        tabId = tab.id;
        groupLabel = grpLabel;
      } else {
        groupLabel = parts[0];
        if (builderState.state.activeTabId) {
          tabId = builderState.state.activeTabId;
        } else if (schema.layout.tabs.length > 0) {
          tabId = schema.layout.tabs[0].id;
        } else {
          // Create first tab
          const newTabId = addTab(schema);
          tabId = newTabId;
          builderState.state.activeTabId = newTabId;
        }
      }

      const tab = schema.layout.tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // Find or create group
      let group = tab.groups.find((g) => g.label.toLowerCase() === groupLabel.toLowerCase());
      if (!group) {
        addGroup(schema, tabId);
        group = tab.groups[tab.groups.length - 1];
        group.label = groupLabel;
        toast.success(`Created new group: ${groupLabel}`);
      }

      // Add item to group
      const itemType = 'name' in item ? 'input' : 'output';
      const paramType = 'name' in item ? item.type : undefined;
      const widgetType = 'name' in item ? undefined : item.type === 'file' ? 'file' : 'text';
      const outputType = 'name' in item ? undefined : item.type;

      handleItemDrop(
        schema,
        group,
        item.id,
        item.nickname || ('name' in item ? item.name : 'Unknown'),
        itemType,
        builderState.state.availableInputs,
        paramType,
        widgetType,
        undefined,
        undefined,
        outputType
      );

      toast.success(`Added ${item.nickname || 'item'} to ${tab.label} / ${group.label}`);
    } else if (schema.layout.type === 'flat') {
      groupLabel = parts[parts.length - 1];

      let group = schema.layout.groups.find((g) => g.label.toLowerCase() === groupLabel.toLowerCase());
      if (!group) {
        addGroup(schema, '');
        group = schema.layout.groups[schema.layout.groups.length - 1];
        group.label = groupLabel;
        toast.success(`Created new group: ${groupLabel}`);
      }

      // Add item to group
      const itemType = 'name' in item ? 'input' : 'output';
      const paramType = 'name' in item ? item.type : undefined;
      const widgetType = 'name' in item ? undefined : item.type === 'file' ? 'file' : 'text';
      const outputType = 'name' in item ? undefined : item.type;

      handleItemDrop(
        schema,
        group,
        item.id,
        item.nickname || ('name' in item ? item.name : 'Unknown'),
        itemType,
        builderState.state.availableInputs,
        paramType,
        widgetType,
        undefined,
        undefined,
        outputType
      );

      toast.success(`Added ${item.nickname || 'item'} to ${group.label}`);
    }
  }

  function onAddTab() {
    const context = ensureSchema();
    if (!context) return;
    const { builderState, schema } = context;
    const newTabId = addTab(schema);
    builderState.state.activeTabId = newTabId;
  }

  function onRemoveTab(tabId: string) {
    const context = ensureSchema();
    if (!context) return;
    const { builderState, schema } = context;
    removeTab(schema, tabId);

    if (
      schema.layout.type === 'tabbed' &&
      builderState.state.activeTabId === tabId &&
      schema.layout.tabs.length > 0
    ) {
      builderState.state.activeTabId = schema.layout.tabs[0].id;
    }
  }

  function onReorderTabs(fromIndex: number, toIndex: number) {
    const context = ensureSchema();
    if (!context) return;
    reorderTabs(context.schema, fromIndex, toIndex);
  }

  function onReorderGroups(tabId: string, fromIndex: number, toIndex: number) {
    const context = ensureSchema();
    if (!context) return;
    reorderGroups(context.schema, tabId, fromIndex, toIndex);
  }

  function onAddGroup(tabId: string) {
    const context = ensureSchema();
    if (!context) return;
    addGroup(context.schema, tabId);
  }

  function onRemoveGroup(tabId: string, groupId: string) {
    const context = ensureSchema();
    if (!context) return;
    removeGroup(context.schema, tabId, groupId);
  }

  function onRemoveItem(tabId: string, groupId: string, itemId: string) {
    const context = ensureSchema();
    if (!context) return;
    removeItem(context.schema, tabId, groupId, itemId);
  }

  function onBatchConvertToSliders(onSuccess: () => void) {
    const context = ensureSchema();
    if (!context) return;
    const { schema } = context;

    const result = batchSetNumberWidgetType(schema, true);
    if (result.changed > 0) {
      toast.success(`Converted ${result.changed} number input(s) to sliders`);
      onSuccess();
    } else {
      toast.info('No number inputs found to convert');
    }
  }

  function onBatchConvertToNumberInputs(onSuccess: () => void) {
    const context = ensureSchema();
    if (!context) return;
    const { schema } = context;

    const result = batchSetNumberWidgetType(schema, false);
    if (result.changed > 0) {
      toast.success(`Converted ${result.changed} slider(s) to number inputs`);
      onSuccess();
    } else {
      toast.info('No sliders found to convert');
    }
  }

  return {
    onParameterDrop,
    onReorder,
    onAddToGroup,
    onAddToNewGroup,
    onAddTab,
    onRemoveTab,
    onReorderTabs,
    onReorderGroups,
    onAddGroup,
    onRemoveGroup,
    onRemoveItem,
    onBatchConvertToSliders,
    onBatchConvertToNumberInputs,
  };
}
