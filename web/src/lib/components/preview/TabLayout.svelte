<script lang="ts">
	import type { UISchema, InputParamSchema, OutputParamSchema, SupportedTypes } from '$lib/types/generated';
	import * as Card from '$lib/components/ui/card';
	import StateDisplay from '../ui/StateDisplay.svelte';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';

	interface Props {
		schema: UISchema;
		values: Record<string, unknown>;
		onValueChange: (paramId: string, value: SupportedTypes) => void;
		debounceSliders?: boolean;
	}

	let { schema, values = $bindable(), onValueChange, debounceSliders = false }: Props = $props();

	let activeTabId: string | null = $state(null);

	// Track collapsed state for each group (keyed by group id)
	let collapsedGroups = $state<Record<string, boolean>>({});

	// Initialize first tab as active and set initial collapsed states
	$effect(() => {
		if (schema.layout.tabs && schema.layout.tabs.length > 0 && !activeTabId) {
			activeTabId = schema.layout.tabs[0].id;
		}

		// Initialize collapsed states from schema
		if (schema.layout.tabs) {
			const initialCollapsed: Record<string, boolean> = {};
			schema.layout.tabs.forEach((tab) => {
				tab.groups.forEach((group) => {
					if (!(group.id in collapsedGroups)) {
						initialCollapsed[group.id] = group.collapsed;
					}
				});
			});
			if (Object.keys(initialCollapsed).length > 0) {
				collapsedGroups = { ...collapsedGroups, ...initialCollapsed };
			}
		}
	});

	function toggleGroup(groupId: string) {
		collapsedGroups = {
			...collapsedGroups,
			[groupId]: !collapsedGroups[groupId]
		};
	}

	const activeTab = $derived(schema.layout.tabs?.find((t) => t.id === activeTabId));

	// Lookup by paramId (GUID from LayoutItem)
	function getInputById(paramId: string): InputParamSchema | undefined {
		return schema.inputs.find((i) => i.id === paramId);
	}

	function getOutputById(paramId: string): OutputParamSchema | undefined {
		return schema.outputs.find((o) => o.id === paramId);
	}
</script>

<Card.Root class="w-full gap-0 overflow-hidden py-0 shadow-sm">
	<!-- Tab Navigation -->
	<div class="flex overflow-x-auto border-b-2 border-border bg-muted">
		{#each schema.layout.tabs || [] as tab}
			<button
				class={`flex items-center gap-2 border-b-4 px-6 py-4 font-medium whitespace-nowrap transition-all ${
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

	<!-- Tab Content -->
	{#if activeTab}
		<Card.Content class="animate-[fadeIn_0.3s] p-8">
			{#if activeTab.groups.length === 0}
				<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
			{:else}
				<div class="flex flex-col gap-8">
					{#each activeTab.groups as group}
						<Card.Root class="gap-0 overflow-hidden py-0">
							<!-- Group Header -->
							<button
								class="flex w-full cursor-pointer items-center justify-between border-b border-border bg-muted px-6 py-2 transition-colors hover:bg-muted/80"
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
									class="grid animate-[fadeIn_0.2s] gap-6 p-6"
									style="grid-template-columns: repeat({group.columns}, 1fr);"
								>
									{#each group.items as layoutItem}
										{#if layoutItem.type === 'input'}
											{@const input = getInputById(layoutItem.paramId)}
											{#if input}
												<InputControl
													item={layoutItem}
													bind:value={values[input.id]}
													displayName={layoutItem.displayName}
													onChange={onValueChange}
													debounceMs={debounceSliders &&
													layoutItem.widgetType === 'number' &&
													(layoutItem.config as any).renderAsSlider
														? 20
														: 0}
												/>
											{/if}
										{:else if layoutItem.type === 'output'}
											{@const output = getOutputById(layoutItem.paramId)}
											{#if output}
												<OutputDisplay
													item={layoutItem}
													value={values[output.id]}
													displayName={layoutItem.displayName}
												/>
											{/if}
										{/if}
									{/each}
								</Card.Content>
							{/if}
						</Card.Root>
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
