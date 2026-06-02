import type {
	UISchema,
	DiscoveredInput,
	DiscoveredOutput,
	SchemaInput,
	TabConfig,
	GroupConfig,
	LayoutItem,
	InputLayoutItem,
	OutputLayoutItem
} from '@selvajs/schemas';
import { getGroups, getLayoutItems } from '@selvajs/schemas';
import { mapParamTypeToWidgetType, createDefaultWidgetConfig } from './widget-config';

// Re-exported from the shared @selvajs/schemas traversal module so the layout walk lives
// in one place. Kept under the local name for existing callers.
export { getLayoutItems as getAllLayoutItems };

export function isInputItem(item: DiscoveredInput | DiscoveredOutput): item is DiscoveredInput {
	return 'name' in item;
}

// ============================================================================
// Group container seam
// ============================================================================
//
// Most mutators below need the same two things: "the groups for a tab" and "write the
// mutated groups back where they belong." In tabbed mode that's a tab's `groups` (plus
// reassigning `layout.tabs` to nudge reactivity); in flat mode it's `layout.groups`. A
// GroupContainer hides that split so each mutator stays one branch-free function, and
// the reactivity write-back ritual lives in exactly one place.

interface GroupContainer {
	groups: GroupConfig[];
	setGroups(next: GroupConfig[]): void;
}

/**
 * Resolves the mutable group container addressed by `tabId`. In tabbed mode this is the
 * matching tab; in flat mode `tabId` is ignored and the layout itself is the container.
 * Returns undefined when there's no layout or the tab id doesn't match.
 */
function resolveGroupContainer(schema: UISchema, tabId: string): GroupContainer | undefined {
	if (!schema?.layout) return undefined;

	if (schema.layout.type === 'tabbed') {
		const layout = schema.layout;
		const tab = layout.tabs.find((t) => t.id === tabId);
		if (!tab) return undefined;
		return {
			get groups() {
				return tab.groups;
			},
			setGroups(next) {
				tab.groups = next;
				layout.tabs = [...layout.tabs];
			}
		};
	}

	if (schema.layout.type === 'flat') {
		const layout = schema.layout;
		return {
			get groups() {
				return layout.groups;
			},
			setGroups(next) {
				layout.groups = next;
			}
		};
	}

	return undefined;
}

export function isItemUsedInLayout(schema: UISchema | null, paramId: string): boolean {
	if (!schema) return false;
	return getLayoutItems(schema).some((i) => i.type !== 'linebreak' && i.paramId === paramId);
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
	availableInputs: DiscoveredInput[],
	availableOutputs: DiscoveredOutput[],
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
	const fullOutput =
		itemType === 'output' ? availableOutputs.find((o) => o.id === paramId) : undefined;

	// Get description from discovered parameters
	const description =
		itemType === 'input' ? (fullParam?.description ?? '') : (fullOutput?.description ?? '');

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
				description,
				widgetType: resolvedWidgetType as any,
				order: itemCount,
				span: 1,
				config
			} as InputLayoutItem)
		: ({
				id: crypto.randomUUID().substring(0, 8),
				paramId,
				type: 'output',
				displayName,
				description,
				widgetType: resolvedWidgetType as any,
				order: itemCount,
				span: 1,
				config: itemType === 'output' && resolvedWidgetType === 'file' ? {} : config
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

export interface ItemDropOptions {
	schema: UISchema;
	group: GroupConfig;
	paramId: string;
	displayName: string;
	itemType: 'input' | 'output';
	availableInputs: DiscoveredInput[];
	availableOutputs: DiscoveredOutput[];
	paramType?: string;
	widgetType?: string;
	targetItem?: LayoutItem;
	dropPosition?: 'before' | 'after';
	outputType?: 'text' | 'number' | 'file' | 'chart';
}

/**
 * Outcome of a drop. `added` means a layout item was inserted; `duplicate` means the
 * param was already in the target group and nothing changed. The duplicate label lets
 * the caller phrase its own notification — operations.ts stays UI-free (no toast).
 */
export type ItemDropResult =
	| { added: true }
	| { added: false; duplicate: true; itemLabel: 'file component' | 'parameter' | 'output' };

export function handleItemDrop({
	schema,
	group,
	paramId,
	displayName,
	itemType,
	availableInputs,
	availableOutputs,
	paramType,
	widgetType,
	targetItem,
	dropPosition,
	outputType
}: ItemDropOptions): ItemDropResult {
	if (group.items.some((i) => i.type !== 'linebreak' && i.paramId === paramId)) {
		const itemLabel =
			widgetType === 'file' ? 'file component' : itemType === 'input' ? 'parameter' : 'output';
		return { added: false, duplicate: true, itemLabel };
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
					description: ''
				} as SchemaInput
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
					description: ''
				} as DiscoveredOutput
			];
		}
	}

	const newItem = createLayoutItem(
		paramId,
		displayName,
		itemType,
		group.items.length,
		availableInputs,
		availableOutputs,
		widgetType,
		paramType
	);
	insertLayoutItem(group, newItem, targetItem, dropPosition);
	return { added: true };
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
	if (!schema?.layout) return;

	let sourceGroup: GroupConfig | undefined;
	let targetGroup: GroupConfig | undefined;

	if (schema.layout.type === 'tabbed') {
		const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
		const targetTab = schema.layout.tabs.find((t) => t.id === tabId);
		if (!sourceTab || !targetTab) return;

		sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
		targetGroup = targetTab.groups.find((g) => g.id === groupId);
	} else if (schema.layout.type === 'flat') {
		sourceGroup = schema.layout.groups.find((g) => g.id === sourceGroupId);
		targetGroup = schema.layout.groups.find((g) => g.id === groupId);
	}

	if (!sourceGroup || !targetGroup) return;

	const sourceIndex = sourceGroup.items.findIndex((i) => i.id === sourceItem.id);
	if (sourceIndex < 0) return;

	const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);
	insertLayoutItem(targetGroup, movedItem, targetItem, dropPosition);
}

export function addTab(schema: UISchema): string {
	if (!schema.layout || schema.layout.type !== 'tabbed') return '';

	const newTab: TabConfig = {
		id: crypto.randomUUID().substring(0, 8),
		label: `Tab ${schema.layout.tabs.length + 1}`,
		icon: '',
		order: schema.layout.tabs.length,
		groups: []
	};

	schema.layout.tabs = [...schema.layout.tabs, newTab];
	return newTab.id;
}

export function removeTab(schema: UISchema, tabId: string) {
	if (!schema.layout || schema.layout.type !== 'tabbed') return;

	const tab = schema.layout.tabs.find((t) => t.id === tabId);
	if (!tab) return;

	tab.groups.forEach((group) => {
		group.items.forEach((item) => {
			if (item.type !== 'linebreak') removeItemIfOrphaned(schema, item.paramId, item.type);
		});
	});

	schema.layout.tabs = schema.layout.tabs.filter((t) => t.id !== tabId);
}

export function addGroup(schema: UISchema, tabId: string) {
	const container = resolveGroupContainer(schema, tabId);
	if (!container) return;

	const newGroup: GroupConfig = {
		id: crypto.randomUUID().substring(0, 8),
		label: `Group ${container.groups.length + 1}`,
		description: '',
		order: container.groups.length,
		collapsed: false,
		columns: 1,
		items: []
	};

	container.setGroups([...container.groups, newGroup]);
}

export function removeGroup(schema: UISchema, tabId: string, groupId: string) {
	const container = resolveGroupContainer(schema, tabId);
	if (!container) return;
	container.setGroups(container.groups.filter((g) => g.id !== groupId));
}

export function removeItem(schema: UISchema, tabId: string, groupId: string, itemId: string) {
	const container = resolveGroupContainer(schema, tabId);
	const group = container?.groups.find((g) => g.id === groupId);
	if (!group) return;

	const item = group.items.find((i) => i.id === itemId);
	group.items = group.items.filter((i) => i.id !== itemId);

	if (item && item.type !== 'linebreak') {
		removeItemIfOrphaned(schema, item.paramId, item.type);
	}
}

export function reorderTabs(schema: UISchema, fromIndex: number, toIndex: number) {
	if (!schema.layout || schema.layout.type !== 'tabbed') return;

	const tabs = [...schema.layout.tabs];
	const [movedTab] = tabs.splice(fromIndex, 1);
	tabs.splice(toIndex, 0, movedTab);

	tabs.forEach((tab, index) => {
		tab.order = index;
	});

	schema.layout.tabs = tabs;
}

export function moveGroupToTab(
	schema: UISchema,
	sourceTabId: string,
	groupId: string,
	targetTabId: string,
	targetIndex?: number
): boolean {
	if (!schema.layout || schema.layout.type !== 'tabbed') return false;
	if (sourceTabId === targetTabId) return false;

	const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
	const targetTab = schema.layout.tabs.find((t) => t.id === targetTabId);
	if (!sourceTab || !targetTab) return false;

	const idx = sourceTab.groups.findIndex((g) => g.id === groupId);
	if (idx === -1) return false;

	const sourceGroups = [...sourceTab.groups];
	const [movedGroup] = sourceGroups.splice(idx, 1);

	const targetGroups = [...targetTab.groups];
	if (targetIndex === undefined || targetIndex < 0 || targetIndex > targetGroups.length) {
		targetGroups.push(movedGroup);
	} else {
		targetGroups.splice(targetIndex, 0, movedGroup);
	}

	sourceGroups.forEach((g, i) => (g.order = i));
	targetGroups.forEach((g, i) => (g.order = i));

	sourceTab.groups = sourceGroups;
	targetTab.groups = targetGroups;
	schema.layout.tabs = [...schema.layout.tabs];
	return true;
}

export function reorderGroups(schema: UISchema, tabId: string, fromIndex: number, toIndex: number) {
	const container = resolveGroupContainer(schema, tabId);
	if (!container) return;

	const newGroups = [...container.groups];
	const [movedGroup] = newGroups.splice(fromIndex, 1);
	newGroups.splice(toIndex, 0, movedGroup);
	newGroups.forEach((group, index) => {
		group.order = index;
	});

	container.setGroups(newGroups);
}

export function batchSetNumberWidgetType(
	schema: UISchema,
	renderAsSlider: boolean
): { changed: number } {
	let count = 0;

	for (const group of getGroups(schema)) {
		for (const item of group.items) {
			// Only process input number widgets
			if (item.type === 'input' && item.widgetType === 'number') {
				if (item.config && 'renderAsSlider' in item.config) {
					item.config.renderAsSlider = renderAsSlider;
					count++;
				}
			}
		}
	}

	return { changed: count };
}
