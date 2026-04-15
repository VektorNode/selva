import { toast } from 'selva-shared';
import type { DiscoveredInput, DiscoveredOutput, GroupConfig, LayoutItem } from 'selva-shared';
import {
	handleItemDrop,
	addTab,
	removeTab,
	addGroup,
	removeGroup,
	removeItem,
	reorderTabs,
	reorderGroups,
	batchSetNumberWidgetType
} from '$lib/features/builder/operations';
import type { useBuilderState } from './useBuilderState.svelte';

export function useBuilderActions(
	getBuilderState: () => ReturnType<typeof useBuilderState> | null
) {
	function ensureSchema() {
		const builderState = getBuilderState();
		if (!builderState?.state.schema) return null;
		return { builderState, schema: builderState.state.schema };
	}

	function onParameterDrop(tabId: string, groupId: string, event: CustomEvent) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

		const { dropType, data, targetItem, dropPosition } = event.detail;

		let group: GroupConfig | undefined;

		if (schema.layout.type === 'tabbed') {
			const tab = schema.layout.tabs.find((t) => t.id === tabId);
			if (!tab) return;
			group = tab.groups.find((g) => g.id === groupId);
		} else if (schema.layout.type === 'flat') {
			group = schema.layout.groups.find((g) => g.id === groupId);
		}

		if (!group) return;

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
				builderState.state.availableOutputs,
				param.type,
				undefined,
				targetItem,
				dropPosition
			);
		} else if (dropType === 'output') {
			const output = data as DiscoveredOutput;
			const widgetType =
				output.type === 'file' ? 'file' : output.type === 'chart' ? 'chart' : 'text';
			handleItemDrop(
				schema,
				group,
				output.id,
				output.nickname,
				'output',
				builderState.state.availableInputs,
				builderState.state.availableOutputs,
				undefined,
				widgetType,
				targetItem,
				dropPosition,
				output.type
			);
		}
	}

	function onReorder(newItems: LayoutItem[], tabId: string, groupId: string) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		builderState.history.push($state.snapshot(schema));

		let group: GroupConfig | undefined;
		if (schema.layout.type === 'tabbed') {
			group = schema.layout.tabs.find((t) => t.id === tabId)?.groups.find((g) => g.id === groupId);
		} else if (schema.layout.type === 'flat') {
			group = schema.layout.groups.find((g) => g.id === groupId);
		}

		if (group) group.items = newItems;
	}

	function onAddToGroup(tabId: string, groupId: string, item: DiscoveredInput | DiscoveredOutput) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

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
			builderState.state.availableOutputs,
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

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

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
				builderState.state.availableOutputs,
				paramType,
				widgetType,
				undefined,
				undefined,
				outputType
			);

			toast.success(`Added ${item.nickname || 'item'} to ${tab.label} / ${group.label}`);
		} else if (schema.layout.type === 'flat') {
			groupLabel = parts[parts.length - 1];

			let group = schema.layout.groups.find(
				(g) => g.label.toLowerCase() === groupLabel.toLowerCase()
			);
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
				builderState.state.availableOutputs,
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

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

		const newTabId = addTab(schema);
		builderState.state.activeTabId = newTabId;
	}

	function onRemoveTab(tabId: string) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

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

		// Save snapshot before mutation
		context.builderState.history.push($state.snapshot(context.schema));

		reorderTabs(context.schema, fromIndex, toIndex);
	}

	function onReorderGroups(tabId: string, fromIndex: number, toIndex: number) {
		const context = ensureSchema();
		if (!context) return;

		// Save snapshot before mutation
		context.builderState.history.push($state.snapshot(context.schema));

		reorderGroups(context.schema, tabId, fromIndex, toIndex);
	}

	function onAddGroup(tabId: string) {
		const context = ensureSchema();
		if (!context) return;

		// Save snapshot before mutation
		context.builderState.history.push($state.snapshot(context.schema));

		addGroup(context.schema, tabId);
	}

	function onRemoveGroup(tabId: string, groupId: string) {
		const context = ensureSchema();
		if (!context) return;

		// Save snapshot before mutation
		context.builderState.history.push($state.snapshot(context.schema));

		removeGroup(context.schema, tabId, groupId);
	}

	function onRemoveItem(tabId: string, groupId: string, itemId: string) {
		const context = ensureSchema();
		if (!context) return;

		// Save snapshot before mutation
		context.builderState.history.push($state.snapshot(context.schema));

		removeItem(context.schema, tabId, groupId, itemId);
	}

	function onAddLineBreak(tabId: string, groupId: string) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		builderState.history.push($state.snapshot(schema));

		let group: GroupConfig | undefined;
		if (schema.layout.type === 'tabbed') {
			group = schema.layout.tabs.find((t) => t.id === tabId)?.groups.find((g) => g.id === groupId);
		} else if (schema.layout.type === 'flat') {
			group = schema.layout.groups.find((g) => g.id === groupId);
		}
		if (!group) return;

		group.items.push({ id: crypto.randomUUID().substring(0, 8), type: 'linebreak' });
	}

	function onBatchConvertToSliders(onSuccess: () => void) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

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
		const { builderState, schema } = context;

		// Save snapshot before mutation
		builderState.history.push($state.snapshot(schema));

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
		onAddLineBreak,
		onBatchConvertToSliders,
		onBatchConvertToNumberInputs
	};
}
