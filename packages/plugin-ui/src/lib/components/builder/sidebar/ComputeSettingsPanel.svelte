<script lang="ts">
	import type { UISchema, ViewerOptions } from '@selvajs/schemas';
	import { Switch } from '@selvajs/ui';
	import { listSourcedInputs, SOURCE_KIND_LABELS } from '$lib/features/builder';
	import ScopeNote from '../scope/ScopeNote.svelte';
	import ScopeChip from '../scope/ScopeChip.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingRow from './SettingRow.svelte';

	interface Props {
		schema: UISchema;
		onSchemaChange: (schema: UISchema) => void;
		onRevealItem: (tabId: string, groupId: string, itemId: string) => void;
	}

	let { schema, onSchemaChange, onRevealItem }: Props = $props();

	const sourcedInputs = $derived(listSourcedInputs(schema));

	function updateSchema(updates: Partial<UISchema>) {
		onSchemaChange({ ...schema, ...updates });
	}

	function updateViewerOptions(updates: Partial<ViewerOptions>) {
		updateSchema({ viewerOptions: { ...schema.viewerOptions, ...updates } });
	}
</script>

<ScopeNote scope="compute">Used when Selva solves this definition on Rhino.Compute.</ScopeNote>

<SettingsSection id="compute.rendering" title="Rendering">
	<SettingRow
		label="Compute render"
		for="enable-remote-rendering"
		layout="inline"
		hint="Show the geometry Rhino.Compute returns in Selva's viewer."
	>
		<Switch
			id="enable-remote-rendering"
			checked={schema.viewerOptions?.enableRemote ?? false}
			onCheckedChange={(checked) => updateViewerOptions({ enableRemote: checked })}
		/>
	</SettingRow>
</SettingsSection>

<SettingsSection
	id="compute.sources"
	title="Input sources"
	description="Inputs filled by something other than the form."
>
	{#if sourcedInputs.length === 0}
		<p class="border-border text-muted-foreground rounded-md border px-3 py-2.5 text-xs">
			Every input comes from the form.
		</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each sourcedInputs as { tabId, groupId, item, kind } (item.id)}
				<li>
					<button
						type="button"
						class="border-border bg-background hover:bg-accent/50 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
						onclick={() => onRevealItem(tabId, groupId, item.id)}
					>
						<span class="min-w-0 truncate text-sm font-medium">{item.displayName}</span>
						<ScopeChip scope="compute" label={SOURCE_KIND_LABELS[kind]} />
						{#if item.source?.key}
							<span class="text-muted-foreground ml-auto truncate font-mono text-xs">
								{item.source.key}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="text-muted-foreground text-xs">Set a source on the input's card, under Compute only.</p>
</SettingsSection>
