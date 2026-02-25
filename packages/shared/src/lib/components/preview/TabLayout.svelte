<script lang="ts">
	import type {
		UISchema,
		SchemaInput,
		DiscoveredOutput,
		SupportedTypes
	} from '$lib/types/generated';
	import * as Card from '$lib/components/ui/card';
	import StateDisplay from '../ui/StateDisplay.svelte';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';

	interface Props {
		schema: UISchema;
		values: Record<string, unknown>;
		onValueChange: (paramId: string, value: SupportedTypes) => void;
		environment?: 'local' | 'compute';
		/** Filter tabs by panel position. 'left' shows unpositioned + left tabs, 'right' shows right tabs only. Omit to show all. */
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

	// Track collapsed state for each group (keyed by group id)
	let collapsedGroups = $state<Record<string, boolean>>({});

	// Filter tabs by panel position
	const visibleTabs = $derived(
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.filter((tab) => {
					if (!panelFilter) return true;
					if (panelFilter === 'right') return tab.position === 'right';
					return tab.position !== 'right';
				})
			: []
	);

	const showTabBar = $derived(visibleTabs.length > 1);

	// Initialize first tab as active and set initial collapsed states
	$effect(() => {
		if (requestedTabId && visibleTabs.some((t) => t.id === requestedTabId)) {
			activeTabId = requestedTabId;
		} else if (visibleTabs.length > 0 && !activeTabId) {
			activeTabId = visibleTabs[0].id;
		}

		// Initialize collapsed states from schema
		if (schema.layout.type === 'tabbed') {
			const initialCollapsed: Record<string, boolean> = {};
			schema.layout.tabs.forEach((tab) => {
				tab.groups.forEach((group) => {
					if (!(group.id in collapsedGroups)) {
						initialCollapsed[group.id] = group.collapsed ?? false;
					}
				});
			});
			if (Object.keys(initialCollapsed).length > 0) {
				Object.assign(collapsedGroups, initialCollapsed);
			}
		}
	});

	// Apply default values when visibility conditions change
	// Runs on mount AND whenever values change
	$effect(() => {
		if (schema.layout.type === 'tabbed') {
			// Track all value updates to apply them in batch
			const updates: Record<string, unknown> = {};

			visibleTabs.forEach((tab) => {
				tab.groups.forEach((group) => {
					group.items.forEach((layoutItem) => {
						const visibility = evaluateVisibility(layoutItem);
						const input = getInputById(layoutItem.paramId);

						if (!input) return;

						// Apply default value when conditions are met
						if (visibility.defaultValue !== undefined) {
							const shouldApplyDefault = !visibility.visible || visibility.disabled;

							if (shouldApplyDefault && values[input.id] !== visibility.defaultValue) {
								updates[input.id] = visibility.defaultValue;
							}
						}
					});
				});
			});

			// Apply all updates at once to minimize reactive triggers
			if (Object.keys(updates).length > 0) {
				Object.assign(values, updates);
			}
		}
	});

	function toggleGroup(groupId: string) {
		collapsedGroups[groupId] = !collapsedGroups[groupId];
	}

	const activeTab = $derived(visibleTabs.find((t) => t.id === activeTabId));

	// Lookup by paramId (GUID from LayoutItem)
	function getInputById(paramId: string): SchemaInput | undefined {
		return schema.inputs.find((i) => i.id === paramId);
	}

	function getOutputById(paramId: string): DiscoveredOutput | undefined {
		return schema.outputs.find((o) => o.id === paramId);
	}

	// Evaluate a single visibility rule
	function evaluateRule(rule: any, currentValues: Record<string, unknown>): boolean {
		const ruleValue = currentValues[rule.paramId];
		const compareValue = rule.value;

		switch (rule.operator) {
			case 'equals':
				return ruleValue === compareValue;
			case 'notEquals':
				return ruleValue !== compareValue;
			case 'greaterThan':
				return Number(ruleValue) > Number(compareValue);
			case 'lessThan':
				return Number(ruleValue) < Number(compareValue);
			case 'greaterThanOrEqual':
				return Number(ruleValue) >= Number(compareValue);
			case 'lessThanOrEqual':
				return Number(ruleValue) <= Number(compareValue);
			case 'between':
				if (rule.values && rule.values.length === 2) {
					const numValue = Number(ruleValue);
					return numValue >= Number(rule.values[0]) && numValue <= Number(rule.values[1]);
				}
				return false;
			case 'in':
				return rule.values ? rule.values.includes(String(ruleValue)) : false;
			case 'notIn':
				return rule.values ? !rule.values.includes(String(ruleValue)) : true;
			case 'matches':
				try {
					const regex = new RegExp(String(compareValue));
					return regex.test(String(ruleValue));
				} catch {
					return false;
				}
			default:
				return false;
		}
	}

	// Evaluate visibility condition for an item
	function evaluateVisibility(item: any): {
		visible: boolean;
		disabled: boolean;
		defaultValue?: unknown;
	} {
		if (!item.visibilityCondition || !item.visibilityCondition.rules) {
			return { visible: true, disabled: false };
		}

		const condition = item.visibilityCondition;
		const rules = condition.rules;

		// Evaluate all rules
		const ruleResults = rules.map((rule: any) => evaluateRule(rule, values));

		// Apply mode (all = AND, any = OR)
		const conditionMet =
			condition.mode === 'any'
				? ruleResults.some((result: boolean) => result)
				: ruleResults.every((result: boolean) => result);

		// Apply action
		const action = condition.action || 'show';

		if (action === 'show') {
			return { visible: conditionMet, disabled: false };
		} else if (action === 'hide') {
			return { visible: !conditionMet, disabled: false, defaultValue: condition.defaultValue };
		} else if (action === 'disable') {
			return {
				visible: true,
				disabled: conditionMet,
				defaultValue: conditionMet ? condition.defaultValue : undefined
			};
		}

		return { visible: true, disabled: false };
	}

	// Evaluate visibility condition for a group
	function evaluateGroupVisibility(group: any): { visible: boolean } {
		if (!group.visibilityCondition || !group.visibilityCondition.rules) {
			return { visible: true };
		}

		const condition = group.visibilityCondition;
		const rules = condition.rules;

		// Evaluate all rules
		const ruleResults = rules.map((rule: any) => evaluateRule(rule, values));

		// Apply mode (all = AND, any = OR)
		const conditionMet =
			condition.mode === 'any'
				? ruleResults.some((result: boolean) => result)
				: ruleResults.every((result: boolean) => result);

		// Apply action (for groups, only show/hide)
		const action = condition.action || 'show';

		// console.log('Group visibility evaluation:', {
		// 	groupId: group.id,
		// 	ruleResults,
		// 	conditionMet,
		// 	action
		// });

		if (action === 'show') {
			return { visible: conditionMet };
		} else if (action === 'hide') {
			return { visible: !conditionMet };
		}

		return { visible: true };
	}
</script>

<Card.Root class="min-h-0 gap-0 py-0 shadow-sm flex w-full flex-col overflow-hidden">
	<!-- Tab Navigation — hidden when only one tab -->
	{#if showTabBar}
		<div class="flex shrink-0 overflow-x-auto border-b-2 border-border bg-muted">
			{#each visibleTabs as tab (tab.id)}
				<button
					class={`gap-2 px-6 py-4 font-medium flex items-center border-b-4 whitespace-nowrap transition-all ${
						activeTabId === tab.id
							? 'border-primary bg-card text-primary'
							: 'border-transparent text-muted-foreground hover:bg-muted/80 hover:text-foreground'
					}`}
					onclick={() => (activeTabId = tab.id)}
				>
					{#if tab.icon}<span class="text-lg">{tab.icon}</span>{/if}
					{tab.label}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Tab Content -->
	{#if activeTab}
		<Card.Content class="min-h-0 p-4 animate-[fadeIn_0.3s] overflow-y-auto">
			{#if activeTab.groups.length === 0}
				<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
			{:else}
				<div class="gap-8 flex flex-col">
					{#each activeTab.groups as group (group.id)}
						{@const groupVisibility = evaluateGroupVisibility(group)}
						{#if groupVisibility.visible}
							<Card.Root class="gap-0 py-0 overflow-hidden">
								<!-- Group Header -->
								<button
									class="px-6 py-2 flex w-full cursor-pointer items-center justify-between border-b border-border bg-muted transition-colors hover:bg-muted/80"
									onclick={() => toggleGroup(group.id)}
								>
									<div class="text-left">
										<h3 class="m-0 mb-1 text-lg font-semibold text-foreground">
											{group.label}
										</h3>
										{#if group.description}
											<p class="m-0 text-sm text-muted-foreground">
												{group.description}
											</p>
										{/if}
									</div>
									<span
										class="text-sm text-muted-foreground transition-transform duration-200 {collapsedGroups[
											group.id
										]
											? ''
											: 'rotate-180'}"
									>
										▼
									</span>
								</button>

								<!-- Group Content -->
								{#if !collapsedGroups[group.id]}
									<Card.Content
										class="gap-6 p-6 grid animate-[fadeIn_0.2s] overflow-x-auto"
										style="grid-template-columns: repeat({group.columns}, minmax(0, 1fr));"
									>
										{#each group.items as layoutItem (layoutItem.paramId)}
											{@const visibility = evaluateVisibility(layoutItem)}
											{#if visibility.visible}
												{#if layoutItem.type === 'input'}
													{@const input = getInputById(layoutItem.paramId)}
													{#if input}
														<div
															class="min-w-0 overflow-hidden"
															class:opacity-50={visibility.disabled}
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
</style>
