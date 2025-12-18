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
		debounceSliders?: boolean;
	}

	let { schema, values = $bindable(), onValueChange }: Props = $props();

	let activeTabId: string | null = $state(null);

	// Track collapsed state for each group (keyed by group id)
	let collapsedGroups = $state<Record<string, boolean>>({});

	// Initialize first tab as active and set initial collapsed states
	$effect(() => {
		if (schema.layout.type === 'tabbed' && schema.layout.tabs.length > 0 && !activeTabId) {
			activeTabId = schema.layout.tabs[0].id;
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

	const activeTab = $derived(
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.find((t) => t.id === activeTabId)
			: undefined
	);

	// Lookup by paramId (GUID from LayoutItem)
	function getInputById(paramId: string): SchemaInput | undefined {
		return schema.inputs.find((i) => i.id === paramId);
	}

	function getOutputById(paramId: string): DiscoveredOutput | undefined {
		return schema.outputs.find((o) => o.id === paramId);
	}
</script>

<Card.Root class="min-h-0 gap-0 py-0 shadow-sm flex w-full flex-col overflow-hidden">
	<!-- Tab Navigation -->
	<div class="flex shrink-0 overflow-x-auto border-b-2 border-border bg-muted">
		{#each schema.layout.type === 'tabbed' ? schema.layout.tabs : [] as tab}
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

	<!-- Tab Content -->
	{#if activeTab}
		<Card.Content class="min-h-0 p-8 animate-[fadeIn_0.3s] overflow-y-auto">
			{#if activeTab.groups.length === 0}
				<StateDisplay type="empty" size="medium" message="This tab has no groups configured." />
			{:else}
				<div class="gap-8 flex flex-col">
					{#each activeTab.groups as group}
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
									{#each group.items as layoutItem}
										{#if layoutItem.type === 'input'}
											{@const input = getInputById(layoutItem.paramId)}
											{#if input}
												<div class="min-w-0 overflow-hidden">
													<InputControl
														item={layoutItem}
														bind:value={values[input.id]}
														displayName={layoutItem.displayName}
														onChange={onValueChange}
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
