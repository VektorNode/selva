<script lang="ts">
	import DraggableParameter from '../DraggableParameter.svelte';
	import StateDisplay from './StateDisplay.svelte';
	import type { AvailableParameter } from '$lib/types/schema';

	interface ParameterListProps {
		title: string;
		icon: string;
		parameters: AvailableParameter[];
		category: 'input' | 'output';
		emptyMessage?: string;
	}

	let {
		title,
		icon,
		parameters,
		category,
		emptyMessage = 'No parameters found.'
	}: ParameterListProps = $props();
</script>

<div class="mb-6">
	<h3 class="text-base font-semibold text-gray-700 mb-3">
		{icon}
		{title} ({parameters.length})
	</h3>
	{#if parameters.length === 0}
		<StateDisplay type="empty" size="small" message={emptyMessage} />
	{:else}
		<div class="flex flex-col gap-0">
			{#each parameters as param}
				<DraggableParameter parameter={param} {category} />
			{/each}
		</div>
	{/if}
</div>
