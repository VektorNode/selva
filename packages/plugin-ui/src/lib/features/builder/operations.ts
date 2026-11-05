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

	const description =
		itemType === 'input' ? (fullParam?.description ?? '') : (fullOutput?.description ?? '');

	let config =
		itemType === 'input' && paramType
			? createDefaultWidgetConfig(
					resolvedWidgetType as any,
					fullParam || ({ type: paramType } as any),
					'input'
				)
			: itemType === 'output' && paramType
				? createDefaultWidgetConfig(resolvedWidgetType as any, { type: paramType } as any, 'output')
				: {};

	// Dynamic value list outputs route to a target input; seed targetInputId from discovery.
	if (itemType === 'output' && resolvedWidgetType === 'dynamicValueList' && fullOutput) {
		config = { targetInputId: fullOutput.targetInputId ?? '' };
	}

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
	outputType?: 'text' | 'number' | 'file' | 'chart' | 'dynamicValueList';
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
			const discoveredOutput = availableOutputs.find((o) => o.id === paramId);

			schema.outputs = [
				...schema.outputs,
				{
					id: paramId,
					nickname: displayName,
					type: finalOutputType,
					description: '',
					...(finalOutputType === 'dynamicValueList'
						? { targetInputId: discoveredOutput?.targetInputId ?? '' }
						: {})
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

/**
 * Moves placed items, by layout item id, into the target group in layout order: right after
 * `afterItemId` when it is in the target, else at the end. Items already in the target, or whose
 * parameter the target already holds, stay where they are. Returns the moved count.
 */
export function moveItemsToGroup(
	schema: UISchema,
	itemIds: ReadonlySet<string>,
	targetGroupId: string,
	afterItemId?: string
): number {
	const groups = getGroups(schema);
	const target = groups.find((g) => g.id === targetGroupId);
	if (!target) return 0;

	const held = new Set(target.items.flatMap((t) => (t.type === 'linebreak' ? [] : [t.paramId])));
	const moving: LayoutItem[] = [];
	for (const group of groups) {
		if (group === target) continue;
		const keep: LayoutItem[] = [];
		for (const item of group.items) {
			const paramId = item.type === 'linebreak' ? undefined : item.paramId;
			if (itemIds.has(item.id) && !(paramId && held.has(paramId))) {
				moving.push(item);
				if (paramId) held.add(paramId);
			} else keep.push(item);
		}
		if (keep.length !== group.items.length) group.items = keep;
	}
	if (moving.length === 0) return 0;

	const anchor = afterItemId ? target.items.findIndex((i) => i.id === afterItemId) : -1;
	const at = anchor === -1 ? target.items.length : anchor + 1;
	target.items = [...target.items.slice(0, at), ...moving, ...target.items.slice(at)];
	return moving.length;
}

/** `stem 1`, `stem 2`… the first not in `taken`, compared as tab names are. */
export function nextFreeLabel(taken: Iterable<string>, stem: string, from = 1): string {
	const used = new Set([...taken].map(normalizeLabel));
	let n = from;
	while (used.has(normalizeLabel(`${stem} ${n}`))) n++;
	return `${stem} ${n}`;
}

const normalizeLabel = (label: string) => label.trim().toLowerCase();

/**
 * Tab names are unique in the form, group names within their tab, ignoring case and surrounding
 * spaces. `siblings` are the tabs, or the groups of one tab; `exceptId` is the one being renamed.
 */
export function isLabelTaken(
	siblings: { id: string; label: string }[],
	label: string,
	exceptId?: string
): boolean {
	const wanted = normalizeLabel(label);
	return siblings.some((s) => s.id !== exceptId && normalizeLabel(s.label) === wanted);
}

export function addTab(schema: UISchema): string {
	if (!schema.layout || schema.layout.type !== 'tabbed') return '';

	const newTab: TabConfig = {
		id: crypto.randomUUID().substring(0, 8),
		label: nextFreeLabel(
			schema.layout.tabs.map((t) => t.label),
			'Tab'
		),
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
		label: nextFreeLabel(
			container.groups.map((g) => g.label),
			'Group'
		),
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
	// Group names are unique within a tab: "Size" landing beside a "Size" becomes "Size 2".
	if (isLabelTaken(targetTab.groups, movedGroup.label))
		movedGroup.label = nextFreeLabel(
			targetTab.groups.map((g) => g.label),
			movedGroup.label.trim(),
			2
		);

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

// ============================================================================
// Placements: put whole params into a group, moving them if placed elsewhere
// ============================================================================

/** One param to place at the end of `groupId`. A missing tab or group is created with these ids. */
export interface ParamPlacement {
	paramId: string;
	itemType: 'input' | 'output';
	tabId?: string | null;
	tabLabel?: string | null;
	groupId: string;
	groupLabel: string;
}

/** What the item factory needs to build a fresh layout item for a param not yet placed. */
export interface PlacementSources {
	availableInputs: DiscoveredInput[];
	availableOutputs: DiscoveredOutput[];
	/**
	 * The plugin's newer canonical. Its layout item is copied as is, because the plugin seeds
	 * config the editor cannot derive (a Dynamic Value List's target input); its inputs and
	 * outputs cover params discovery hasn't reported yet.
	 */
	fallback?: Pick<UISchema, 'inputs' | 'outputs' | 'layout'>;
}

/** Removes every layout item for `paramId`; the param itself stays in `schema.inputs`/`outputs`. */
export function removeParamFromLayout(schema: UISchema, paramId: string): LayoutItem[] {
	const removed: LayoutItem[] = [];
	for (const group of getGroups(schema)) {
		const keep = group.items.filter((i) => i.type === 'linebreak' || i.paramId !== paramId);
		if (keep.length === group.items.length) continue;
		removed.push(...group.items.filter((i) => !keep.includes(i)));
		group.items = keep;
	}
	return removed;
}

/** Where a param sits in the layout. `tabId` is null in a flat layout. */
export function locateParam(
	schema: Pick<UISchema, 'layout'>,
	paramId: string
): { tabId: string | null; group: GroupConfig; item: LayoutItem } | undefined {
	const layout = schema.layout;
	const containers: { tabId: string | null; groups: GroupConfig[] }[] =
		layout?.type === 'tabbed'
			? layout.tabs.map((t) => ({ tabId: t.id, groups: t.groups }))
			: layout?.type === 'flat'
				? [{ tabId: null, groups: layout.groups }]
				: [];
	for (const { tabId, groups } of containers) {
		for (const group of groups) {
			const item = group.items.find((i) => i.type !== 'linebreak' && i.paramId === paramId);
			if (item) return { tabId, group, item };
		}
	}
	return undefined;
}

function ensurePlacementGroup(
	schema: UISchema,
	placement: ParamPlacement
): GroupConfig | undefined {
	const existing = getGroups(schema).find((g) => g.id === placement.groupId);
	if (existing) return existing;

	let containerId = '';
	if (schema.layout?.type === 'tabbed') {
		const layout = schema.layout;
		let tab = placement.tabId ? layout.tabs.find((t) => t.id === placement.tabId) : layout.tabs[0];
		if (!tab) {
			tab = {
				id: placement.tabId ?? crypto.randomUUID().substring(0, 8),
				label: placement.tabLabel ?? `Tab ${layout.tabs.length + 1}`,
				icon: '',
				order: layout.tabs.length,
				groups: []
			};
			layout.tabs = [...layout.tabs, tab];
		}
		containerId = tab.id;
	}

	const container = resolveGroupContainer(schema, containerId);
	if (!container) return undefined;
	const group: GroupConfig = {
		id: placement.groupId,
		label: placement.groupLabel,
		description: '',
		order: container.groups.length,
		collapsed: false,
		columns: 1,
		items: []
	};
	container.setGroups([...container.groups, group]);
	// setGroups may have swapped arrays; hand back the object that is actually in the layout.
	return container.groups.find((g) => g.id === group.id);
}

function adoptParamEntry(
	schema: UISchema,
	from: Pick<UISchema, 'inputs' | 'outputs'>,
	{ paramId, itemType }: ParamPlacement
): void {
	if (itemType === 'input') {
		const entry = from.inputs.find((p) => p.id === paramId);
		if (entry && !schema.inputs.some((p) => p.id === paramId))
			schema.inputs = [...schema.inputs, structuredClone(entry)];
	} else {
		const entry = from.outputs.find((o) => o.id === paramId);
		if (entry && !schema.outputs.some((o) => o.id === paramId))
			schema.outputs = [...schema.outputs, structuredClone(entry)];
	}
}

function buildPlacedItem(
	schema: UISchema,
	group: GroupConfig,
	placement: ParamPlacement,
	sources: PlacementSources
): boolean {
	const { paramId, itemType } = placement;
	const { availableInputs, availableOutputs, fallback } = sources;
	const committed = fallback && locateParam(fallback, paramId)?.item;
	if (committed) {
		adoptParamEntry(schema, fallback, placement);
		group.items = [...group.items, structuredClone(committed)];
		return true;
	}

	const base = { schema, group, paramId, availableInputs, availableOutputs };

	if (itemType === 'input') {
		const discovered = availableInputs.find((p) => p.id === paramId);
		const known = fallback?.inputs.find((p) => p.id === paramId);
		if (!discovered && !known) return false;
		handleItemDrop({
			...base,
			itemType,
			displayName: discovered?.nickname || discovered?.name || known?.nickname || 'unnamed',
			paramType: discovered?.type ?? known?.paramType
		});
		return true;
	}

	const discovered = availableOutputs.find((o) => o.id === paramId);
	const known = fallback?.outputs.find((o) => o.id === paramId);
	const outputType = discovered?.type ?? known?.type;
	if (!outputType) return false;
	handleItemDrop({
		...base,
		itemType,
		displayName: discovered?.nickname || known?.nickname || 'Unknown',
		widgetType: mapParamTypeToWidgetType(outputType, 'output'),
		outputType
	});
	return true;
}

/**
 * Appends each param to its target group in order. A param already placed is moved, keeping its
 * layout item and so its config, because a param appears once in the form. Returns the params
 * that ended up placed; one with no item and nothing to build it from is skipped.
 */
export function applyPlacements(
	schema: UISchema,
	placements: ParamPlacement[],
	sources: PlacementSources
): string[] {
	const placed: string[] = [];
	for (const placement of placements) {
		const group = ensurePlacementGroup(schema, placement);
		if (!group) continue;
		const [existing] = removeParamFromLayout(schema, placement.paramId);
		if (existing) {
			group.items = [...group.items, existing];
			placed.push(placement.paramId);
		} else if (buildPlacedItem(schema, group, placement, sources)) {
			placed.push(placement.paramId);
		}
	}
	return placed;
}

/** Where a param sits in a layout, by label: what the canvas draws under the param. */
export interface DraftPlacement {
	paramId: string;
	tabLabel: string | null;
	groupLabel: string;
}

export function draftPlacements(schema: Pick<UISchema, 'layout'>): DraftPlacement[] {
	const layout = schema.layout;
	const containers: { tabLabel: string | null; groups: GroupConfig[] }[] =
		layout?.type === 'tabbed'
			? layout.tabs.map((t) => ({ tabLabel: t.label, groups: t.groups }))
			: layout?.type === 'flat'
				? [{ tabLabel: null, groups: layout.groups }]
				: [];
	const placements: DraftPlacement[] = [];
	for (const { tabLabel, groups } of containers)
		for (const group of groups)
			for (const item of group.items)
				if (item.type !== 'linebreak')
					placements.push({ paramId: item.paramId, tabLabel, groupLabel: group.label });
	return placements;
}
