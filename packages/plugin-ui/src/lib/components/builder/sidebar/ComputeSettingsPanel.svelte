<script lang="ts">
	import type { UISchema } from '@selvajs/schemas';
	import { listSourcedInputs, SOURCE_KIND_LABELS } from '#lib/features/builder/index.js';
	import ScopeChip from '../scope/ScopeChip.svelte';
	import SettingsSection from './SettingsSection.svelte';

	interface Props {
		schema: UISchema;
		onRevealItem: (tabId: string, groupId: string, itemId: string) => void;
	}

	let { schema, onRevealItem }: Props = $props();

	const sourcedInputs = $derived(listSourcedInputs(schema));
</script>

<SettingsSection id="compute.sources" title="Input sources" collapsible={false}>
	{#if sourcedInputs.length === 0}
		<p
			class="border-border text-muted-foreground rounded-md border border-dashed px-3 py-3 text-xs"
		>
			No input has a source. Open an input's card and set <span class="text-foreground"
				>Value source</span
			>.
		</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each sourcedInputs as { tabId, groupId, item, kind } (item.id)}
				<li>
					<button
						type="button"
						class="border-border bg-background hover:bg-hover flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
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
</SettingsSection>
