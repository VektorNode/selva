<script lang="ts">
	import type { UISchema, SupportedTypes } from '@selvajs/schemas';
	import * as Card from '$lib/components/primitives/card';
	import * as Tabs from '$lib/components/primitives/tabs';
	import TabBar from './TabBar.svelte';
	import TabContent from './TabContent.svelte';
	import { buildVisibilityMap, itemKey } from '$lib/schema/visibility-rules';
	import { buildDynamicValueListOptions } from '$lib/schema/dynamic-value-list';

	interface Props {
		schema: UISchema;
		values: Record<string, unknown>;
		onValueChange: (paramId: string, value: SupportedTypes, forceSolve?: boolean) => void;
		/** Filter tabs by panel position. 'left' shows unpositioned + left tabs, 'right' shows right tabs only. */
		panelFilter?: 'left' | 'right';
		/** Externally request a specific tab to be active (e.g. from collapsed strip click) */
		requestedTabId?: string | null;
	}

	let { schema, values, onValueChange, panelFilter, requestedTabId = null }: Props = $props();

	let activeTabId = $state('');
	let collapsedGroups = $state<Record<string, boolean>>({});

	const visibleTabs = $derived(
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.filter((tab) => {
					if (!panelFilter) return true;
					return panelFilter === 'right' ? tab.position === 'right' : tab.position !== 'right';
				})
			: []
	);

	const showTabBar = $derived(visibleTabs.length > 1);

	// Computed value list options keyed by the target input id, derived from solved outputs.
	const dynamicOptions = $derived(buildDynamicValueListOptions(schema, values));

	$effect(() => {
		if (requestedTabId && visibleTabs.some((t) => t.id === requestedTabId)) {
			activeTabId = requestedTabId;
		} else if (visibleTabs.length > 0 && !activeTabId) {
			activeTabId = visibleTabs[0].id;
		}
	});

	// Seed each group's collapsed state once; re-seeding would discard the user's own toggles.
	$effect(() => {
		if (schema.layout.type !== 'tabbed') return;
		const initial: Record<string, boolean> = {};
		schema.layout.tabs.forEach((tab) =>
			tab.groups.forEach((group) => {
				if (!(group.id in collapsedGroups)) initial[group.id] = group.collapsed ?? false;
			})
		);
		if (Object.keys(initial).length > 0) Object.assign(collapsedGroups, initial);
	});

	// A hidden or disabled input still solves, so reset it to its default: otherwise the
	// value the user last set while it was visible keeps feeding the definition.
	$effect(() => {
		if (schema.layout.type !== 'tabbed') return;
		const updates: Record<string, unknown> = {};
		visibleTabs.forEach((tab) =>
			tab.groups.forEach((group) => {
				const visibilityMap = buildVisibilityMap(group.items, values);
				group.items.forEach((layoutItem) => {
					if (layoutItem.type === 'linebreak') return;
					const { visible, disabled, defaultValue } = visibilityMap[itemKey(layoutItem)];
					const input = schema.inputs.find((i) => i.id === layoutItem.paramId);
					if (!input || defaultValue === undefined) return;
					if ((!visible || disabled) && values[input.id] !== defaultValue) {
						updates[input.id] = defaultValue;
					}
				});
			})
		);
		if (Object.keys(updates).length > 0) Object.assign(values, updates);
	});

	function toggleGroup(groupId: string) {
		collapsedGroups[groupId] = !collapsedGroups[groupId];
	}

	function handleTabChange(tabId: string) {
		activeTabId = tabId;
	}
</script>

<Card.Root class="pt-1 min-h-0 mx-1 flex flex-1 flex-col overflow-hidden">
	<Tabs.Root value={activeTabId} class="gap-0 min-h-0 flex flex-1 flex-col">
		{#if showTabBar}
			<TabBar tabs={visibleTabs} onTabChange={handleTabChange} />
		{/if}

		{#each visibleTabs as tab (tab.id)}
			<TabContent
				{tab}
				{values}
				{collapsedGroups}
				onToggleGroup={toggleGroup}
				{onValueChange}
				inputs={schema.inputs}
				outputs={schema.outputs}
				{dynamicOptions}
			/>
		{/each}
	</Tabs.Root>
</Card.Root>
