import { toast } from '@selvajs/ui';
import type { DiscoveredInput, DiscoveredOutput, GroupConfig, LayoutItem } from '@selvajs/schemas';
import {
	handleItemDrop,
	type ItemDropOptions,
	addTab,
	removeTab,
	addGroup,
	removeGroup,
	removeItem,
	reorderTabs,
	reorderGroups,
	moveGroupToTab,
	batchSetNumberWidgetType,
	isInputItem
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

		const base: Pick<ItemDropOptions, 'schema' | 'group' | 'availableInputs' | 'availableOutputs' | 'targetItem' | 'dropPosition'> = {
			schema,
			group,
			availableInputs: builderState.state.availableInputs,
			availableOutputs: builderState.state.availableOutputs,
			targetItem,
			dropPosition
		};

		if (dropType === 'input') {
			const param = data as DiscoveredInput;
			handleItemDrop({ ...base, paramId: param.id, displayName: param.nickname || 'unnamed', itemType: 'input', paramType: param.type });
		} else if (dropType === 'output') {
			const output = data as DiscoveredOutput;
			handleItemDrop({ ...base, paramId: output.id, displayName: output.nickname, itemType: 'output', widgetType: output.type === 'file' ? 'file' : output.type === 'chart' ? 'chart' : 'text', outputType: output.type });
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

		const asInput = isInputItem(item);
		handleItemDrop({
			schema,
			group,
			paramId: item.id,
			displayName: item.nickname || (asInput ? item.name : 'Unknown'),
			itemType: asInput ? 'input' : 'output',
			availableInputs: builderState.state.availableInputs,
			availableOutputs: builderState.state.availableOutputs,
			paramType: asInput ? item.type : undefined,
			widgetType: asInput ? undefined : item.type === 'file' ? 'file' : 'text',
			outputType: asInput ? undefined : item.type
		});

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

			const asInput = isInputItem(item);
			handleItemDrop({
				schema,
				group,
				paramId: item.id,
				displayName: item.nickname || (asInput ? item.name : 'Unknown'),
				itemType: asInput ? 'input' : 'output',
				availableInputs: builderState.state.availableInputs,
				availableOutputs: builderState.state.availableOutputs,
				paramType: asInput ? item.type : undefined,
				widgetType: asInput ? undefined : item.type === 'file' ? 'file' : 'text',
				outputType: asInput ? undefined : item.type
			});

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

			const asInput = isInputItem(item);
			handleItemDrop({
				schema,
				group,
				paramId: item.id,
				displayName: item.nickname || (asInput ? item.name : 'Unknown'),
				itemType: asInput ? 'input' : 'output',
				availableInputs: builderState.state.availableInputs,
				availableOutputs: builderState.state.availableOutputs,
				paramType: asInput ? item.type : undefined,
				widgetType: asInput ? undefined : item.type === 'file' ? 'file' : 'text',
				outputType: asInput ? undefined : item.type
			});

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

	function onMoveGroupToTab(sourceTabId: string, groupId: string, targetTabId: string) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		if (sourceTabId === targetTabId) return;

		builderState.history.push($state.snapshot(schema));

		const moved = moveGroupToTab(schema, sourceTabId, groupId, targetTabId);
		if (!moved) return;

		if (schema.layout.type === 'tabbed') {
			const targetTab = schema.layout.tabs.find((t) => t.id === targetTabId);
			if (targetTab) {
				builderState.state.activeTabId = targetTabId;
				toast.success(`Moved group to ${targetTab.label}`);
			}
		}
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

	/**
	 * Bulk-import the given GH group names: for each, create (or reuse) a builder
	 * group with the same label in the active tab (or flat layout) and add every
	 * unplaced input/output whose `groupName` matches.
	 *
	 * Returns the number of items added so the caller can surface a toast.
	 */
	function onImportGhGroups(
		groupNames: string[],
		availableInputs: DiscoveredInput[],
		availableOutputs: DiscoveredOutput[],
		placedIds: Set<string>
	) {
		const context = ensureSchema();
		if (!context) return;
		const { builderState, schema } = context;

		if (groupNames.length === 0) return;

		builderState.history.push($state.snapshot(schema));

		let tabId = '';
		if (schema.layout.type === 'tabbed') {
			if (builderState.state.activeTabId) {
				tabId = builderState.state.activeTabId;
			} else if (schema.layout.tabs.length > 0) {
				tabId = schema.layout.tabs[0].id;
			} else {
				const newTabId = addTab(schema);
				tabId = newTabId;
				builderState.state.activeTabId = newTabId;
			}
		}

		let totalAdded = 0;

		for (const groupName of groupNames) {
			let group: GroupConfig | undefined;

			if (schema.layout.type === 'tabbed') {
				const tab = schema.layout.tabs.find((t) => t.id === tabId);
				if (!tab) continue;

				group = tab.groups.find((g) => g.label.toLowerCase() === groupName.toLowerCase());
				if (!group) {
					addGroup(schema, tabId);
					group = tab.groups[tab.groups.length - 1];
					group.label = groupName;
				}
			} else if (schema.layout.type === 'flat') {
				group = schema.layout.groups.find(
					(g) => g.label.toLowerCase() === groupName.toLowerCase()
				);
				if (!group) {
					addGroup(schema, '');
					group = schema.layout.groups[schema.layout.groups.length - 1];
					group.label = groupName;
				}
			}

			if (!group) continue;

			const inputsForGroup = availableInputs.filter(
				(i) => i.groupName?.trim() === groupName && !placedIds.has(i.id)
			);
			const outputsForGroup = availableOutputs.filter(
				(o) => o.groupName?.trim() === groupName && !placedIds.has(o.id)
			);

			for (const param of inputsForGroup) {
				handleItemDrop({
					schema,
					group,
					paramId: param.id,
					displayName: param.nickname || param.name || 'unnamed',
					itemType: 'input',
					availableInputs,
					availableOutputs,
					paramType: param.type
				});
				totalAdded++;
			}

			for (const output of outputsForGroup) {
				handleItemDrop({
					schema,
					group,
					paramId: output.id,
					displayName: output.nickname,
					itemType: 'output',
					availableInputs,
					availableOutputs,
					widgetType:
						output.type === 'file' ? 'file' : output.type === 'chart' ? 'chart' : 'text',
					outputType: output.type
				});
				totalAdded++;
			}
		}

		if (totalAdded > 0) {
			toast.success(`Imported ${totalAdded} item(s) from ${groupNames.length} GH group(s)`);
		} else {
			toast.info('No new items to import — all already placed.');
		}
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
		onMoveGroupToTab,
		onAddGroup,
		onRemoveGroup,
		onRemoveItem,
		onAddLineBreak,
		onBatchConvertToSliders,
		onBatchConvertToNumberInputs,
		onImportGhGroups
	};
}
