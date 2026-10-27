<script lang="ts">
	import type { UISchema, SupportedTypes } from '@selvajs/schemas';
	import * as Card from '#lib/components/primitives/card/index.js';
	import * as Tabs from '#lib/components/primitives/tabs/index.js';
	import TabBar from './TabBar.svelte';
	import TabContent from './TabContent.svelte';
	import { isTabVisible } from '#lib/schema/visibility-rules.js';
	import { buildDynamicValueListOptions } from '#lib/schema/dynamic-value-list.js';

	interface Props {
		schema: UISchema;
		values: Record<string, unknown>;
		onValueChange: (paramId: string, value: SupportedTypes, forceSolve?: boolean) => void;
		/** Filter tabs by panel position. 'left' shows unpositioned + left tabs, 'right' shows right tabs only. */
		panelFilter?: 'left' | 'right';
		/** Externally request a specific tab to be active (e.g. from collapsed strip click) */
		requestedTabId?: string | null;
		/**
		 * Drops the card frame and the tab's own scroll area, for a container that already frames
		 * and scrolls it (the phone drawer). Nested, the inner scroll gets only a sliver of height.
		 */
		bare?: boolean;
	}

	let {
		schema,
		values,
		onValueChange,
		panelFilter,
		requestedTabId = null,
		bare = false
	}: Props = $props();

	let activeTabId = $state('');
	let collapsedGroups = $state<Record<string, boolean>>({});

	const visibleTabs = $derived(
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.filter((tab) => {
					if (!isTabVisible(tab, values)) return false;
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
		} else if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTabId)) {
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

	function toggleGroup(groupId: string) {
		collapsedGroups[groupId] = !collapsedGroups[groupId];
	}

	function handleTabChange(tabId: string) {
		activeTabId = tabId;
	}
</script>

{#snippet tabs()}
	<Tabs.Root value={activeTabId} variant="line" class="min-h-0 flex-1">
		{#if showTabBar}
			<TabBar tabs={visibleTabs} {activeTabId} onTabChange={handleTabChange} />
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
				assets={schema.assets}
				{bare}
			/>
		{/each}
	</Tabs.Root>
{/snippet}

{#if bare}
	{@render tabs()}
{:else}
	<Card.Root variant="flush" class="min-h-0 mx-1 flex-1">
		{@render tabs()}
	</Card.Root>
{/if}
