<script lang="ts">
	import type {
		UISchema,
		SchemaInput,
		DiscoveredOutput,
		SupportedTypes
	} from '$lib/types/generated';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { ChevronDown } from '@lucide/svelte';
	import StateDisplay from '../ui/StateDisplay.svelte';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';
	import Icon from '@iconify/svelte';

	interface Props {
		schema: UISchema;
		values: Record<string, unknown>;
		onValueChange: (paramId: string, value: SupportedTypes) => void;
		environment?: 'local' | 'compute';
		/** Filter tabs by panel position. 'left' shows unpositioned + left tabs, 'right' shows right tabs only. */
		panelFilter?: 'left' | 'right';
		/** Externally request a specific tab to be active (e.g. from collapsed strip click) */
		requestedTabId?: string | null;
	}

	let {
		schema,
		values = $bindable(),
		onValueChange,
		environment,
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

	$effect(() => {
		if (requestedTabId && visibleTabs.some((t) => t.id === requestedTabId)) {
			activeTabId = requestedTabId;
		} else if (visibleTabs.length > 0 && !activeTabId) {
			activeTabId = visibleTabs[0].id;
		}

		if (schema.layout.type === 'tabbed') {
			const initialCollapsed: Record<string, boolean> = {};
			schema.layout.tabs.forEach((tab) =>
				tab.groups.forEach((group) => {
					if (!(group.id in collapsedGroups)) initialCollapsed[group.id] = group.collapsed ?? false;
				})
			);
			if (Object.keys(initialCollapsed).length > 0)
				Object.assign(collapsedGroups, initialCollapsed);
		}
	});

	// Apply default values when visibility conditions change
	$effect(() => {
		if (schema.layout.type !== 'tabbed') return;
		const updates: Record<string, unknown> = {};
		visibleTabs.forEach((tab) =>
			tab.groups.forEach((group) =>
				group.items.forEach((layoutItem) => {
					const { visible, disabled, defaultValue } = evaluateVisibility(layoutItem);
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

	const RULE_OPERATORS: Record<string, (a: unknown, b: unknown, values?: unknown[]) => boolean> = {
		equals: (a, b) => a === b,
		notEquals: (a, b) => a !== b,
		greaterThan: (a, b) => Number(a) > Number(b),
		lessThan: (a, b) => Number(a) < Number(b),
		greaterThanOrEqual: (a, b) => Number(a) >= Number(b),
		lessThanOrEqual: (a, b) => Number(a) <= Number(b),
		between: (a, _, vals) =>
			vals?.length === 2 && Number(a) >= Number(vals[0]) && Number(a) <= Number(vals[1]),
		in: (a, _, vals) => vals?.includes(String(a)) ?? false,
		notIn: (a, _, vals) => !(vals?.includes(String(a)) ?? false),
		matches: (a, b) => {
			try {
				return new RegExp(String(b)).test(String(a));
			} catch {
				return false;
			}
		}
	};

	function evaluateRule(rule: any): boolean {
		const fn = RULE_OPERATORS[rule.operator];
		return fn ? fn(values[rule.paramId], rule.value, rule.values) : false;
	}

	function evaluateCondition(condition: any): boolean {
		const results = condition.rules.map(evaluateRule);
		return condition.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
	}

	function evaluateVisibility(item: any): {
		visible: boolean;
		disabled: boolean;
		defaultValue?: unknown;
	} {
		if (!item.visibilityCondition?.rules) return { visible: true, disabled: false };
		const { action = 'show', defaultValue } = item.visibilityCondition;
		const met = evaluateCondition(item.visibilityCondition);
		if (action === 'show') return { visible: met, disabled: false };
		if (action === 'hide') return { visible: !met, disabled: false, defaultValue };
		if (action === 'disable')
			return { visible: true, disabled: met, defaultValue: met ? defaultValue : undefined };
		return { visible: true, disabled: false };
	}

	function evaluateGroupVisibility(group: any): boolean {
		if (!group.visibilityCondition?.rules) return true;
		const { action = 'show' } = group.visibilityCondition;
		const met = evaluateCondition(group.visibilityCondition);
		return action === 'hide' ? !met : met;
	}
</script>

{#snippet gridItem(layoutItem: any, columns: number)}
	{@const visibility = evaluateVisibility(layoutItem)}
	{@const span = Math.min(Math.max(1, layoutItem.span ?? 1), columns)}
	{#if visibility.visible}
		{#if layoutItem.type === 'input'}
			{@const input = getInputById(layoutItem.paramId)}
			{#if input}
				<div
					class="min-w-0 overflow-hidden"
					class:opacity-50={visibility.disabled}
					style="grid-column: span {span} / span {span}"
				>
					<InputControl
						item={layoutItem}
						bind:value={values[input.id]}
						displayName={layoutItem.displayName}
						onChange={onValueChange}
						{environment}
						disabled={visibility.disabled}
					/>
				</div>
			{/if}
		{:else if layoutItem.type === 'output'}
			{@const output = getOutputById(layoutItem.paramId)}
			{#if output}
				<div class="min-w-0 overflow-hidden" style="grid-column: span {span} / span {span}">
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

<Card.Root class="pt-1 overflow-hidden">
	<Tabs.Root bind:value={activeTabId} class="gap-0">
		{#if showTabBar}
			<ScrollArea class="w-full border-b border-border" orientation="horizontal">
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
			<Tabs.Content value={tab.id} class="min-h-0 p-4">
				{#if tab.groups.length === 0}
					<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
				{:else}
					<div class="gap-8 flex flex-col">
						{#each tab.groups as group (group.id)}
							{#if evaluateGroupVisibility(group)}
								<Card.Root class="gap-0 py-0 pt-0 overflow-hidden">
									<Card.Header
										class="pt-4 pb-4! cursor-pointer border-b border-border bg-muted transition-colors select-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
										role="button"
										tabindex="0"
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
													class="schema-grid gap-6 grid overflow-x-auto"
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
		overflow: hidden;
		min-height: 0;
	}

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
</style>
