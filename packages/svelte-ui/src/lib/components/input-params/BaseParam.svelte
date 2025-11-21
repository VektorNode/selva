<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { DataTreeDefault } from '@computebuilder/core/grasshopper';
	import {
		isDataTree,
		getValueEntries,
		updateValue,
		type ValueEntry
	} from '../../utils/value-helpers.js';

	type Props<T> = {
		value: T | T[] | DataTreeDefault<T>;
		name: string;
		children: Snippet<[{ entry: ValueEntry<T>; onUpdate: (newValue: T) => void }]>;
	};

	let { value = $bindable(), name, children }: Props<T> = $props();

	// Get all entries for rendering
	const entries = $derived(getValueEntries(value));

	// Single entry helper (most common case)
	const isSingle = $derived(entries.length === 1 && !entries[0].branch);

	// Create update handler for a specific entry
	function createUpdateHandler(entry: ValueEntry<T>) {
		return (newValue: T) => {
			value = updateValue(value, newValue, entry.index, entry.branch);
		};
	}

	// Generate unique ID for inputs
	function generateId(entry: ValueEntry<T>): string {
		if (entry.branch) {
			return `${name}-${entry.branch}-${entry.index}`;
		}
		if (entries.length > 1) {
			return `${name}-${entry.index}`;
		}
		return name;
	}
</script>

{#if isSingle}
	<!-- Single value - render directly without wrapper -->
	{@const entry = entries[0]}
	{@render children({ entry, onUpdate: createUpdateHandler(entry) })}
{:else if isDataTree(value)}
	<!-- DataTree - group by branches -->
	{#each Object.entries(value as DataTreeDefault<T>) as [branch, arr] (branch)}
		<fieldset class="base-param-fieldset">
			<legend class="base-param-legend">{branch}</legend>
			<div class="base-param-branch-content">
				{#each arr ?? [] as item, i (i)}
					{@const entry = { value: item!, index: i, branch }}
					<div class="base-param-item">
						{@render children({ entry, onUpdate: createUpdateHandler(entry) })}
					</div>
				{/each}
			</div>
		</fieldset>
	{/each}
{:else}
	<!-- Array - render with minimal wrapper -->
	<div class="base-param-array">
		{#each entries as entry (entry.branch ?? entry.index)}
			<div class="base-param-item">
				{@render children({ entry, onUpdate: createUpdateHandler(entry) })}
			</div>
		{/each}
	</div>
{/if}

<style>
	.base-param-fieldset {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border: 1px solid rgb(229 231 235);
		border-radius: 0.375rem;
	}

	.base-param-legend {
		padding: 0 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgb(55 65 81);
	}

	.base-param-branch-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.base-param-array {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.base-param-item {
		display: contents;
	}
</style>
