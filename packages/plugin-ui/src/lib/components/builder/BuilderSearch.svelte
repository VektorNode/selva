<script lang="ts">
	import type { DiscoveredInput, DiscoveredOutput, UISchema } from '@selvajs/schemas';
	import { Command, Dialog } from '@selvajs/ui';
	import { ArrowDownToLine, ArrowUpFromLine, Layers, PanelTop, Settings2 } from '@lucide/svelte';
	import {
		buildSearchEntries,
		searchEntries,
		type SearchEntry,
		type SearchTarget
	} from '#lib/features/builder/index.js';

	interface Props {
		open: boolean;
		schema: UISchema;
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		onPick: (target: SearchTarget) => void;
	}

	let { open = $bindable(), schema, availableInputs, availableOutputs, onPick }: Props = $props();

	const KIND_ICONS: Record<SearchEntry['kind'], typeof Layers> = {
		input: ArrowUpFromLine,
		output: ArrowDownToLine,
		group: Layers,
		tab: PanelTop,
		setting: Settings2
	};

	let query = $state('');
	let picked: SearchTarget | null = null;

	const results = $derived(
		searchEntries(buildSearchEntries(schema, availableInputs, availableOutputs), query)
	);

	$effect(() => {
		if (open) query = '';
	});

	function pick(entry: SearchEntry) {
		picked = entry.target;
		open = false;
	}

	// The dialog holds focus until it unmounts, then restores it to the opener. Revealing any
	// earlier loses the focus a setting's control just took, so the pick runs here instead.
	function handleCloseAutoFocus(e: Event) {
		if (!picked) return;
		e.preventDefault();
		onPick(picked);
		picked = null;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		variant="flush"
		showCloseButton={false}
		class="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
		onCloseAutoFocus={handleCloseAutoFocus}
	>
		<Dialog.Title class="sr-only">Search the builder</Dialog.Title>
		<Dialog.Description class="sr-only">
			Find parameters, groups, tabs and settings.
		</Dialog.Description>
		<Command.Root shouldFilter={false} loop>
			<Command.Input
				bind:value={query}
				placeholder="Search parameters, groups, tabs, settings"
				aria-label="Search the builder"
			/>
			<Command.List>
				{#if !query.trim()}
					<p class="text-muted-foreground px-2 py-6 text-center text-sm">
						Find anything in this schema by name, Grasshopper nickname or group.
					</p>
				{:else if results.length === 0}
					<p class="text-muted-foreground px-2 py-6 text-center text-sm">No matches.</p>
				{:else}
					{#each results as entry (entry.key)}
						{@const KindIcon = KIND_ICONS[entry.kind]}
						<Command.Item value={entry.key} onSelect={() => pick(entry)}>
							<KindIcon class="text-muted-foreground" />
							<span class="min-w-0 flex-1 truncate">{entry.label}</span>
							<Command.Shortcut class="max-w-1/2 truncate tracking-normal">
								{entry.detail}
							</Command.Shortcut>
						</Command.Item>
					{/each}
				{/if}
			</Command.List>
		</Command.Root>
	</Dialog.Content>
</Dialog.Root>
