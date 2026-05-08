<script lang="ts">
	import type { DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
	import { Dialog, Button, Checkbox, Label, Badge } from '@selvajs/ui';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	interface Props {
		open: boolean;
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		placedIds: Set<string>;
		onOpenChange: (open: boolean) => void;
		onConfirm: (groupNames: string[]) => void;
	}

	let { open, availableInputs, availableOutputs, placedIds, onOpenChange, onConfirm }: Props =
		$props();

	interface GhGroupSummary {
		name: string;
		inputCount: number;
		outputCount: number;
	}

	const summaries = $derived.by<GhGroupSummary[]>(() => {
		const map = new SvelteMap<string, GhGroupSummary>();

		for (const item of availableInputs) {
			const name = item.groupName?.trim();
			if (!name || placedIds.has(item.id)) continue;
			const entry = map.get(name) ?? { name, inputCount: 0, outputCount: 0 };
			entry.inputCount++;
			map.set(name, entry);
		}

		for (const item of availableOutputs) {
			const name = item.groupName?.trim();
			if (!name || placedIds.has(item.id)) continue;
			const entry = map.get(name) ?? { name, inputCount: 0, outputCount: 0 };
			entry.outputCount++;
			map.set(name, entry);
		}

		return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
	});

	const selected = new SvelteSet<string>();

	// Default all groups to selected when the dialog opens or the list changes
	$effect(() => {
		if (!open) return;
		selected.clear();
		for (const s of summaries) selected.add(s.name);
	});

	function toggle(name: string) {
		if (selected.has(name)) selected.delete(name);
		else selected.add(name);
	}

	function selectAll() {
		for (const s of summaries) selected.add(s.name);
	}

	function clearAll() {
		selected.clear();
	}

	function confirm() {
		onConfirm(Array.from(selected));
		onOpenChange(false);
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-h-[80vh] max-w-lg overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>Add by Grasshopper Group</Dialog.Title>
			<Dialog.Description>
				Each selected group becomes a builder group containing its unplaced inputs and outputs.
			</Dialog.Description>
		</Dialog.Header>

		{#if summaries.length === 0}
			<p class="text-muted-foreground py-6 text-center text-sm">
				No Grasshopper groups detected, or all their parameters are already placed.
			</p>
		{:else}
			<div class="flex items-center justify-between border-b py-2">
				<span class="text-muted-foreground text-xs">
					{selected.size} of {summaries.length} selected
				</span>
				<div class="flex gap-2">
					<Button variant="ghost" size="sm" onclick={selectAll}>Select all</Button>
					<Button variant="ghost" size="sm" onclick={clearAll}>Clear</Button>
				</div>
			</div>

			<div class="max-h-[50vh] overflow-y-auto py-2">
				{#each summaries as summary (summary.name)}
					{@const checked = selected.has(summary.name)}
					{@const checkboxId = `gh-group-${summary.name}`}
					<label
						for={checkboxId}
						class="hover:bg-accent/40 flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-2"
					>
						<div class="flex items-center gap-3">
							<Checkbox id={checkboxId} {checked} onCheckedChange={() => toggle(summary.name)} />
							<Label for={checkboxId} class="cursor-pointer font-medium">{summary.name}</Label>
						</div>
						<div class="flex items-center gap-1">
							{#if summary.inputCount > 0}
								<Badge variant="outline" class="text-[10px]">
									{summary.inputCount} in
								</Badge>
							{/if}
							{#if summary.outputCount > 0}
								<Badge variant="outline" class="text-[10px]">
									{summary.outputCount} out
								</Badge>
							{/if}
						</div>
					</label>
				{/each}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
			<Button onclick={confirm} disabled={selected.size === 0 || summaries.length === 0}>
				Add {selected.size} group{selected.size === 1 ? '' : 's'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
