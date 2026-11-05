<script lang="ts">
	import { ScrollArea, Tooltip } from '@selvajs/ui';
	import { Box, ListTree, Search } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
	import { tick } from 'svelte';
	import { usePersisted } from '#lib/composables/usePersisted.svelte.js';
	import type { SearchTarget } from '#lib/features/builder/index.js';
	import { bringIntoView, setSectionOpeners, type SectionOpeners } from './reveal.js';
	import { SCOPES } from './scope/scopes';
	import ParameterPanel, { type CanvasSelectedParam } from './sidebar/ParameterPanel.svelte';
	import AppSettingsPanel from './sidebar/AppSettingsPanel.svelte';
	import ViewerSettingsPanel from './sidebar/ViewerSettingsPanel.svelte';
	import LocalSettingsPanel from './sidebar/LocalSettingsPanel.svelte';
	import ComputeSettingsPanel from './sidebar/ComputeSettingsPanel.svelte';

	interface Props {
		schema: UISchema;
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		placedIds: Set<string>;
		canvasSelection: CanvasSelectedParam[];
		syncNeeded?: boolean;
		onSchemaChange: (schema: UISchema) => void;
		onSync: () => void;
		onSyncPreview: () => void;
		onBatch: () => void;
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
		/** Opens the builder search. */
		onSearch: () => void;
	}

	let {
		schema,
		availableInputs,
		availableOutputs,
		placedIds,
		canvasSelection,
		syncNeeded = false,
		onSchemaChange,
		onSync,
		onSyncPreview,
		onBatch,
		onAddToGroup,
		onAddToNewGroup,
		onImportGhGroups,
		onRevealItem,
		onSearch
	}: Props = $props();

	const PANELS = ['parameters', 'app', 'viewer', 'local', 'compute'] as const;
	type Panel = (typeof PANELS)[number];
	const panel = usePersisted<Panel>('builder.sidebar.panel', 'parameters');
	$effect(() => {
		if (!PANELS.includes(panel.value)) panel.value = 'parameters';
	});

	const RAIL: {
		value: Panel;
		label: string;
		icon: Component;
		class?: string;
		divider?: boolean;
	}[] = [
		{ value: 'parameters', label: 'Parameters', icon: ListTree },
		{ value: 'app', label: 'App', icon: SCOPES.shared.icon },
		{ value: 'viewer', label: 'Viewer', icon: Box },
		{
			value: 'local',
			label: 'Local',
			icon: SCOPES.local.icon,
			class: SCOPES.local.text,
			divider: true
		},
		{ value: 'compute', label: 'Compute', icon: SCOPES.compute.icon, class: SCOPES.compute.text }
	];

	const unplacedCount = $derived(
		[...availableInputs, ...availableOutputs].filter((p) => !placedIds.has(p.id)).length
	);

	const sectionOpeners: SectionOpeners = new Map();
	setSectionOpeners(sectionOpeners);

	let parameterPanel = $state<ParameterPanel>();

	export async function revealParameter(nickname: string) {
		panel.value = 'parameters';
		await tick();
		parameterPanel?.showParameter(nickname);
	}

	export async function revealSetting({
		panel: target,
		sectionId,
		controlId
	}: Extract<SearchTarget, { kind: 'setting' }>) {
		panel.value = target;
		await tick();
		sectionOpeners.get(sectionId)?.();
		await tick();
		const control = controlId ? document.getElementById(controlId) : null;
		const el = control ?? document.querySelector(`[data-settings-section="${sectionId}"]`);
		if (!el) return;
		bringIntoView(el);
		control?.focus({ preventScroll: true });
	}
</script>

<aside class="bg-card shadow-raised flex h-full overflow-hidden rounded-xl border">
	<div
		role="tablist"
		aria-orientation="vertical"
		class="border-border bg-muted flex w-14 shrink-0 flex-col items-center gap-1.5 border-r py-3"
	>
		<Tooltip.Provider delayDuration={400} disableCloseOnTriggerClick>
			{#each RAIL as item (item.value)}
				{#if item.divider}
					<div class="bg-border my-1.5 h-px w-6"></div>
				{/if}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								role="tab"
								aria-selected={panel.value === item.value}
								aria-label={item.label}
								class="text-muted-foreground hover:text-foreground relative grid size-9 place-items-center rounded-lg transition-colors {panel.value ===
								item.value
									? 'bg-raised text-foreground ring-border-strong shadow-raised ring-1'
									: ''}"
								onclick={() => (panel.value = item.value)}
							>
								<item.icon class="size-4 {item.class ?? ''}" />
								{#if item.value === 'parameters' && unplacedCount > 0}
									<span
										class="bg-foreground text-background absolute -top-0.5 -right-0.5 rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
										>{unplacedCount}</span
									>
								{/if}
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right">{item.label}</Tooltip.Content>
				</Tooltip.Root>
			{/each}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							aria-label="Search the builder"
							class="text-muted-foreground hover:text-foreground mt-auto grid size-9 place-items-center rounded-lg transition-colors"
							onclick={onSearch}
						>
							<Search class="size-4" />
						</button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="right">Search (Ctrl+K)</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>

	<div role="tabpanel" class="flex min-h-0 min-w-0 flex-1 flex-col">
		<h2 class="text-foreground px-5 pt-4 pb-1 text-base font-semibold">
			{RAIL.find((item) => item.value === panel.value)?.label}
		</h2>
		<ScrollArea class="min-h-0 flex-1">
			<div class="px-5 pt-2 pb-6">
				{#if panel.value === 'parameters'}
					<ParameterPanel
						bind:this={parameterPanel}
						tabs={schema.layout?.type === 'tabbed' ? schema.layout.tabs : []}
						{availableInputs}
						{availableOutputs}
						{placedIds}
						{canvasSelection}
						{syncNeeded}
						{onSync}
						{onSyncPreview}
						{onBatch}
						{onAddToGroup}
						{onAddToNewGroup}
						{onImportGhGroups}
					/>
				{:else if panel.value === 'app'}
					<AppSettingsPanel
						{schema}
						{onSchemaChange}
						liveInputs={availableInputs}
						liveOutputs={availableOutputs}
					/>
				{:else if panel.value === 'viewer'}
					<ViewerSettingsPanel {schema} {onSchemaChange} />
				{:else if panel.value === 'local'}
					<LocalSettingsPanel {schema} {onSchemaChange} />
				{:else}
					<ComputeSettingsPanel {schema} {onRevealItem} />
				{/if}
			</div>
		</ScrollArea>
	</div>
</aside>
