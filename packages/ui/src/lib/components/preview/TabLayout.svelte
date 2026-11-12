<script lang="ts">
	import type { OptionMedia, UISchema, SupportedTypes } from '@selvajs/schemas';
	import { getLayoutItems } from '@selvajs/schemas';
	import * as Tabs from '#lib/components/primitives/tabs/index.js';
	import TabBar from './TabBar.svelte';
	import TabContent from './TabContent.svelte';
	import { isTabVisible } from '#lib/schema/visibility-rules.js';
	import {
		buildFormModel,
		keepHiddenPicks,
		withRowPick,
		type FormModel
	} from '#lib/schema/dynamic-value-list.js';

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

	// Option tables are looked up against the values on screen, so a driver change switches its
	// lists here, before any solve.
	let lastModel: FormModel | undefined;
	const formModel = $derived.by(() => (lastModel = buildFormModel(schema, values, lastModel)));

	// An input Grasshopper resolves in the solve shows the resolved pick. What the user picked
	// stays in `values` and goes out unchanged: the solve resolves it the same way.
	const shownValues = $derived({ ...values, ...formModel.shown });

	const visibleTabs = $derived(
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.filter((tab) => {
					if (!isTabVisible(tab, shownValues)) return false;
					if (!panelFilter) return true;
					return panelFilter === 'right' ? tab.position === 'right' : tab.position !== 'right';
				})
			: []
	);

	const showTabBar = $derived(visibleTabs.length > 1);

	// Each repeat is drawn once, at the first of its members placed in the layout.
	const repeatLeads = $derived.by(() => {
		const placed = new Set(
			getLayoutItems(schema)
				.filter((item) => item.type === 'input')
				.map((item) => item.paramId)
		);
		const leads: Record<string, string> = {};
		for (const repeat of formModel.repeats) {
			const lead = repeat.members.find((m) => placed.has(m));
			if (lead) leads[repeat.id] = lead;
		}
		return leads;
	});

	// A repeated input draws its own dropdowns, so its option pictures are handed over by input id.
	const memberMedia = $derived.by(() => {
		const media: Record<string, Record<string, OptionMedia>> = {};
		for (const item of getLayoutItems(schema)) {
			if (item.type !== 'input') continue;
			const config = item.config as { optionMedia?: Record<string, OptionMedia> } | undefined;
			if (config?.optionMedia) media[item.paramId] = config.optionMedia;
		}
		return media;
	});

	const memberLabels = $derived.by(() => {
		const labels: Record<string, string> = {};
		for (const input of schema.inputs) labels[input.id] = input.nickname;
		for (const item of getLayoutItems(schema)) {
			if (item.type === 'input' && item.displayName) labels[item.paramId] = item.displayName;
		}
		return labels;
	});

	// Controls edit the resolved picks, which leave out the ones not offered now. Merge the edit back
	// so those survive it.
	function handleValueChange(paramId: string, value: SupportedTypes, forceSolve?: boolean) {
		const merged =
			Array.isArray(value) && Array.isArray(formModel.shown[paramId])
				? keepHiddenPicks(formModel.options[paramId], values[paramId], value as string[])
				: value;
		onValueChange(paramId, merged as SupportedTypes, forceSolve);
	}

	function handleRowPick(memberId: string, rowKey: string, pick: string) {
		onValueChange(memberId, withRowPick(values[memberId], rowKey, pick));
	}

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
			<TabBar tabs={visibleTabs} {activeTabId} onTabChange={handleTabChange} {bare} />
		{/if}

		{#each visibleTabs as tab (tab.id)}
			<TabContent
				{tab}
				values={shownValues}
				{collapsedGroups}
				onToggleGroup={toggleGroup}
				onValueChange={handleValueChange}
				onRowPick={handleRowPick}
				inputs={schema.inputs}
				outputs={schema.outputs}
				dynamicOptions={formModel.options}
				{formModel}
				{repeatLeads}
				{memberLabels}
				{memberMedia}
				assets={schema.assets}
				{bare}
			/>
		{/each}
	</Tabs.Root>
{/snippet}

{#if bare}
	{@render tabs()}
{:else}
	<div class="min-h-0 flex flex-1 flex-col">
		{@render tabs()}
	</div>
{/if}
