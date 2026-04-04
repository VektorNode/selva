<script lang="ts">
	import type {
		UISchema,
		SchemaInput,
		DiscoveredOutput,
		SupportedTypes,
		LayoutItem
	} from '$lib/types/generated';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { ChevronDown } from '@lucide/svelte';
	import StateDisplay from '../ui/StateDisplay.svelte';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';
	import Icon from '@iconify/svelte';
	import { evaluateGroupVisibility, evaluateVisibility } from '$lib/utils/visibility-rules';

	interface Props {
		schema: UISchema;
		values: Record<string, unknown>;
		onValueChange: (paramId: string, value: SupportedTypes) => void;
		/** Filter tabs by panel position. 'left' shows unpositioned + left tabs, 'right' shows right tabs only. */
		panelFilter?: 'left' | 'right';
		/** Externally request a specific tab to be active (e.g. from collapsed strip click) */
		requestedTabId?: string | null;
	}

	let {
		schema,
		values = $bindable(),
		onValueChange,
		panelFilter,
		requestedTabId = null
	}: Props = $props();

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

	// Tab selection
	$effect(() => {
		if (requestedTabId && visibleTabs.some((t) => t.id === requestedTabId)) {
			activeTabId = requestedTabId;
		} else if (visibleTabs.length > 0 && !activeTabId) {
			activeTabId = visibleTabs[0].id;
		}
	});

	// Collapsed group initialisation — only sets groups that haven't been seen yet
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

	// Apply default values when visibility conditions hide or disable an item
	$effect(() => {
		if (schema.layout.type !== 'tabbed') return;
		const updates: Record<string, unknown> = {};
		visibleTabs.forEach((tab) =>
			tab.groups.forEach((group) =>
				group.items.forEach((layoutItem) => {
					const { visible, disabled, defaultValue } = evaluateVisibility(layoutItem, values);
					const input = getInputById(layoutItem.paramId);
					if (!input || defaultValue === undefined) return;
					if ((!visible || disabled) && values[input.id] !== defaultValue) {
						updates[input.id] = defaultValue;
					}
				})
			)
		);
		if (Object.keys(updates).length > 0) Object.assign(values, updates);
	});

	function toggleGroup(groupId: string) {
		collapsedGroups[groupId] = !collapsedGroups[groupId];
	}

	function handleGroupKeydown(e: KeyboardEvent, groupId: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggleGroup(groupId);
		}
	}

	function getInputById(paramId: string): SchemaInput | undefined {
		return schema.inputs.find((i) => i.id === paramId);
	}

	function getOutputById(paramId: string): DiscoveredOutput | undefined {
		return schema.outputs.find((o) => o.id === paramId);
	}
</script>

{#snippet gridItem(layoutItem: LayoutItem, columns: number)}
	{@const visibility = evaluateVisibility(layoutItem, values)}
	{@const span = Math.min(Math.max(1, layoutItem.span ?? 1), columns)}
	{#if visibility.visible}
		{#if layoutItem.type === 'input'}
			{@const input = getInputById(layoutItem.paramId)}
			{#if input}
				<div
					class="min-w-0 flex items-center"
					class:opacity-50={visibility.disabled}
					style="grid-column: span {span} / span {span}"
				>
					<InputControl
						item={layoutItem}
						value={values[input.id] as SupportedTypes | undefined}
						displayName={layoutItem.displayName}
						onChange={onValueChange}
						disabled={visibility.disabled}
					/>
				</div>
			{/if}
		{:else if layoutItem.type === 'output'}
			{@const output = getOutputById(layoutItem.paramId)}
			{#if output}
				<div class="min-w-0" style="grid-column: span {span} / span {span}">
					<OutputDisplay
						item={layoutItem}
						value={values[layoutItem.paramId]}
						displayName={layoutItem.displayName}
					/>
				</div>
			{/if}
		{/if}
	{/if}
{/snippet}

<Card.Root class="pt-1 min-h-0 mx-1 flex flex-1 flex-col overflow-hidden">
	<Tabs.Root bind:value={activeTabId} class="gap-0 min-h-0 flex flex-1 flex-col">
		{#if showTabBar}
			<ScrollArea class="w-full shrink-0 border-b border-border " orientation="horizontal">
				<Tabs.List
					class="px-2 py-2 gap-0 inline-flex h-auto w-max justify-start rounded-none bg-transparent"
				>
					{#each visibleTabs as tab (tab.id)}
						<Tabs.Trigger
							value={tab.id}
							class="group/tab gap-1.5 px-3 py-1 text-sm font-medium relative h-auto flex-none shrink-0 rounded-none border-0 transition-colors not-last:border-r not-last:border-border hover:bg-accent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
						>
							{#if tab.icon}
								{#if tab.icon.includes(':')}
									<Icon icon={tab.icon} class="h-4 w-4" />
								{:else}
									<span>{tab.icon}</span>
								{/if}
							{/if}
							{tab.label}
						</Tabs.Trigger>
					{/each}
				</Tabs.List>
			</ScrollArea>
		{/if}
		{#each visibleTabs as tab (tab.id)}
			<Tabs.Content value={tab.id} class="min-h-0 p-0 flex-1">
				<ScrollArea class="h-full" orientation="vertical">
					<div class="p-4 tab-content-container">
					{#if tab.groups.length === 0}
						<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
					{:else}
						<div class="gap-8 flex flex-col">
							{#each tab.groups as group (group.id)}
								{#if evaluateGroupVisibility(group, values)}
									<Card.Root class="gap-0 py-0 pt-0 overflow-hidden">
										<Card.Header
											class="pt-4 pb-4! cursor-pointer border-b border-border bg-muted transition-colors select-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
											role="button"
											tabindex={0}
											aria-expanded={!collapsedGroups[group.id]}
											onclick={() => toggleGroup(group.id)}
											onkeydown={(e) => handleGroupKeydown(e, group.id)}
										>
											<Card.Title>{group.label}</Card.Title>
											{#if group.description}
												<Card.Description>{group.description}</Card.Description>
											{/if}
											<Card.Action>
												<ChevronDown
													class="h-4 w-4 text-muted-foreground transition-transform duration-200 {collapsedGroups[
														group.id
													]
														? ''
														: 'rotate-180'}"
												/>
											</Card.Action>
										</Card.Header>
										<div class="content-wrapper" class:collapsed={collapsedGroups[group.id]}>
											<div class="content-inner">
												<Card.Content class="p-6">
													<div
														class="schema-grid gap-6 grid"
														style="--schema-cols: {group.columns};"
													>
														{#each group.items as layoutItem (layoutItem.paramId)}
															{@render gridItem(layoutItem, group.columns ?? 1)}
														{/each}
													</div>
												</Card.Content>
											</div>
										</div>
									</Card.Root>
								{/if}
							{/each}
						</div>
					{/if}
					</div>
				</ScrollArea>
			</Tabs.Content>
		{/each}
	</Tabs.Root>
</Card.Root>

<style>
	.schema-grid {
		grid-template-columns: repeat(var(--schema-cols), minmax(0, 1fr));
	}

	.content-wrapper {
		display: grid;
		grid-template-rows: 1fr;
		transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.content-wrapper.collapsed {
		grid-template-rows: 0fr;
	}

	.content-inner {
		min-height: 0;
	}

	/* Container queries: adapt grid columns to actual panel width, not viewport width */
	.tab-content-container {
		container-type: inline-size;
	}

	@container (max-width: 320px) {
		.schema-grid {
			grid-template-columns: 1fr;
		}
	}
	@container (min-width: 321px) and (max-width: 560px) {
		.schema-grid {
			grid-template-columns: repeat(min(2, var(--schema-cols)), minmax(0, 1fr));
		}
	}

	/* Fallback for browsers without container query support */
	@supports not (container-type: inline-size) {
		@media (max-width: 639px) {
			.schema-grid {
				grid-template-columns: 1fr;
			}
		}
		@media (min-width: 640px) and (max-width: 1023px) {
			.schema-grid {
				grid-template-columns: repeat(min(2, var(--schema-cols)), minmax(0, 1fr));
			}
		}
	}
</style>
