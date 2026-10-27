<script lang="ts">
	import { ScrollArea, Tabs } from '@selvajs/ui';
	import { ListTree } from '@lucide/svelte';
	import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
	import { usePersisted } from '#lib/composables/usePersisted.svelte.js';
	import { SCOPES } from './scope/scopes';
	import ParameterPanel from './sidebar/ParameterPanel.svelte';
	import AppSettingsPanel from './sidebar/AppSettingsPanel.svelte';
	import LocalSettingsPanel from './sidebar/LocalSettingsPanel.svelte';
	import ComputeSettingsPanel from './sidebar/ComputeSettingsPanel.svelte';

	interface Props {
		schema: UISchema;
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		placedIds: Set<string>;
		syncNeeded?: boolean;
		onSchemaChange: (schema: UISchema) => void;
		onSync: () => void;
		onAddToGroup: (
			tabId: string,
			groupId: string,
			item: DiscoveredInput | DiscoveredOutput
		) => void;
		onAddToNewGroup: (path: string, item: DiscoveredInput | DiscoveredOutput) => void;
		onImportGhGroups: (
			groupNames: string[],
			availableInputs: DiscoveredInput[],
			availableOutputs: DiscoveredOutput[],
			placedIds: Set<string>
		) => void;
		/** Brings a placed item into view on the canvas, opening its card. */
		onRevealItem: (tabId: string, groupId: string, itemId: string) => void;
	}

	let {
		schema,
		availableInputs,
		availableOutputs,
		placedIds,
		syncNeeded = false,
		onSchemaChange,
		onSync,
		onAddToGroup,
		onAddToNewGroup,
		onImportGhGroups,
		onRevealItem
	}: Props = $props();

	const PANELS = ['parameters', 'app', 'local', 'compute'] as const;
	type Panel = (typeof PANELS)[number];
	const panel = usePersisted<Panel>('builder.sidebar.panel', 'parameters');
	$effect(() => {
		if (!PANELS.includes(panel.value)) panel.value = 'parameters';
	});

	const unplacedCount = $derived(
		[...availableInputs, ...availableOutputs].filter((p) => !placedIds.has(p.id)).length
	);
</script>

<aside
	class="border-border bg-card flex h-full flex-col overflow-hidden rounded-xl border shadow-sm"
>
	<Tabs.Root bind:value={panel.value} class="flex min-h-0 flex-1 flex-col">
		<!-- Labels need about 24rem; below that the tabs show icons only. `sr-only` keeps each
		     label as the tab's accessible name. -->
		<div class="border-border @container border-b p-2">
			<Tabs.List class="w-full">
				<Tabs.Trigger value="parameters" title="Parameters">
					<ListTree />
					<span class="@max-[24rem]:sr-only">Parameters</span>
					{#if unplacedCount > 0}
						<span class="text-muted-foreground text-xs tabular-nums">{unplacedCount}</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="app" title="App">
					<SCOPES.shared.icon />
					<span class="@max-[24rem]:sr-only">App</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="local" title="Local">
					<SCOPES.local.icon class={SCOPES.local.text} />
					<span class="@max-[24rem]:sr-only">Local</span>
				</Tabs.Trigger>
				<Tabs.Trigger value="compute" title="Compute">
					<SCOPES.compute.icon class={SCOPES.compute.text} />
					<span class="@max-[24rem]:sr-only">Compute</span>
				</Tabs.Trigger>
			</Tabs.List>
		</div>

		<ScrollArea class="min-h-0 flex-1">
			<div class="px-4 pt-1 pb-3">
				<Tabs.Content value="parameters">
					<ParameterPanel
						tabs={schema.layout?.type === 'tabbed' ? schema.layout.tabs : []}
						{availableInputs}
						{availableOutputs}
						{placedIds}
						{syncNeeded}
						{onSync}
						{onAddToGroup}
						{onAddToNewGroup}
						{onImportGhGroups}
					/>
				</Tabs.Content>
				<Tabs.Content value="app">
					<AppSettingsPanel
						{schema}
						{onSchemaChange}
						liveInputs={availableInputs}
						liveOutputs={availableOutputs}
					/>
				</Tabs.Content>
				<Tabs.Content value="local">
					<LocalSettingsPanel {schema} {onSchemaChange} />
				</Tabs.Content>
				<Tabs.Content value="compute">
					<ComputeSettingsPanel {schema} {onSchemaChange} {onRevealItem} />
				</Tabs.Content>
			</div>
		</ScrollArea>
	</Tabs.Root>
</aside>
