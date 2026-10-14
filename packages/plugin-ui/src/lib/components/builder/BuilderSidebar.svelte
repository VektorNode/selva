<script lang="ts">
	import { ScrollArea, Tabs } from '@selvajs/ui';
	import { Box, ListTree, Settings2 } from '@lucide/svelte';
	import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
	import { usePersisted } from '$lib/composables/usePersisted.svelte';
	import ParameterPanel from './sidebar/ParameterPanel.svelte';
	import AppSettingsPanel from './sidebar/AppSettingsPanel.svelte';
	import ViewerSettingsPanel from './sidebar/ViewerSettingsPanel.svelte';

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
		onImportGhGroups
	}: Props = $props();

	const PANELS = ['parameters', 'app', 'viewer'] as const;
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
		<div class="border-border border-b p-2">
			<Tabs.List class="w-full">
				<Tabs.Trigger value="parameters">
					<ListTree />
					Parameters
					{#if unplacedCount > 0}
						<span class="text-muted-foreground text-xs tabular-nums">{unplacedCount}</span>
					{/if}
				</Tabs.Trigger>
				<Tabs.Trigger value="app">
					<Settings2 />
					App
				</Tabs.Trigger>
				<Tabs.Trigger value="viewer">
					<Box />
					Viewer
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
				<Tabs.Content value="viewer">
					<ViewerSettingsPanel {schema} {onSchemaChange} />
				</Tabs.Content>
			</div>
		</ScrollArea>
	</Tabs.Root>
</aside>
