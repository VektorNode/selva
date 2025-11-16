<script lang="ts">
	import type { UISchema } from '$lib/types/schema';
	import InputControl from './InputControl.svelte';
	import OutputDisplay from './OutputDisplay.svelte';
	import { Panel, StateDisplay } from '$lib/components/shared';

	interface Props {
		schema: UISchema;
		values: Record<string, any>;
		onValueChange: (parameterName: string, value: any) => void;
		debounceSliders?: boolean;
	}

	let { schema, values = $bindable(), onValueChange, debounceSliders = false }: Props = $props();
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
	<!-- Inputs Panel -->
	<Panel title="Inputs">
		{#if schema.inputs.length === 0}
			<StateDisplay type="empty" size="small" message="No inputs available" />
		{:else}
			<div class="grid gap-6">
				{#each schema.inputs as input}
					<div class="grid gap-2">
						<InputControl
							{input}
							bind:value={values[input.name]}
							onChange={onValueChange}
							debounceMs={debounceSliders && input.type === 'slider' ? 100 : 0}
						/>
						<span class="text-sm text-gray-600 font-mono">{values[input.name]}</span>
					</div>
				{/each}
			</div>
		{/if}
	</Panel>

	<!-- Outputs Panel -->
	<Panel title="Outputs">
		{#if schema.outputs.length === 0}
			<StateDisplay type="empty" size="small" message="No outputs available" />
		{:else}
			<div class="grid gap-6">
				{#each schema.outputs as output}
					<OutputDisplay {output} value={values[output.name]} />
				{/each}
			</div>
		{/if}
	</Panel>
</div>
