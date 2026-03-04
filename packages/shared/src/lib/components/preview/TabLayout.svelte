<script lang="ts">
	import type {
		UISchema,
		SchemaInput,
		DiscoveredOutput,
		SupportedTypes
	} from '$lib/types/generated';
	import * as Card from '$lib/components/ui/card';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
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

	let activeTabId: string | null = $state(null);
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
	const activeTab = $derived(visibleTabs.find((t) => t.id === activeTabId));

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

{#snippet tabBar()}
	<div class="px-2 py-2 flex shrink-0 overflow-x-auto border-b border-border">
		<ButtonGroup.Root>
			{#each visibleTabs as tab (tab.id)}
				<Button
					variant={activeTabId === tab.id ? 'default' : 'ghost'}
					size="sm"
					class="not-last:border-r not-last:border-border"
					onclick={() => (activeTabId = tab.id)}
				>
					{#if tab.icon}
						{#if tab.icon.includes(':')}
							<Icon icon={tab.icon} class="h-4 w-4" />
						{:else}
							<span>{tab.icon}</span>
						{/if}
					{/if}
					{tab.label}
				</Button>
			{/each}
		</ButtonGroup.Root>
	</div>
{/snippet}

{#snippet gridItem(layoutItem: any)}
	{@const visibility = evaluateVisibility(layoutItem)}
	{#if visibility.visible}
		{#if layoutItem.type === 'input'}
			{@const input = getInputById(layoutItem.paramId)}
			{#if input}
				<div class="min-w-0 overflow-hidden" class:opacity-50={visibility.disabled}>
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
				<div class="min-w-0 overflow-hidden">
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

<Card.Root class="pt-1 overflow-hidden ">
	{#if showTabBar}
		{@render tabBar()}
	{/if}

	{#if activeTab}
		<Card.Content class="min-h-0 p-4 animate-[fadeIn_0.3s] overflow-y-auto">
			{#if activeTab.groups.length === 0}
				<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
			{:else}
				<div class="gap-8 flex flex-col">
					{#each activeTab.groups as group (group.id)}
						{#if evaluateGroupVisibility(group)}
							<Card.Root class="gap-0 py-0  overflow-hidden">
								<Card.Header
									class="mt-4 pb-4! cursor-pointer border-b border-border select-none"
									role="button"
									onclick={() => toggleGroup(group.id)}
									onkeydown={(e) => e.key === 'Enter' && toggleGroup(group.id)}
								>
									<Card.Title>{group.label}</Card.Title>
									{#if group.description}
										<Card.Description class="">{group.description}</Card.Description>
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
								{#if !collapsedGroups[group.id]}
									<Card.Content
										class="gap-6 p-6 schema-grid grid animate-[fadeIn_0.2s] overflow-x-auto"
										style="--schema-cols: {group.columns};"
									>
										{#each group.items as layoutItem (layoutItem.paramId)}
											{@render gridItem(layoutItem)}
										{/each}
									</Card.Content>
								{/if}
							</Card.Root>
						{/if}
					{/each}
				</div>
			{/if}
		</Card.Content>
	{/if}
</Card.Root>

<style>
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.schema-grid {
		grid-template-columns: repeat(var(--schema-cols), minmax(0, 1fr));
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
