<script lang="ts">
	import { Input } from '$lib/components/primitives/input/index.js';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		...props
	}: ComponentProps<typeof Input> = $props();
</script>

<Input
	bind:ref
	data-slot="input-group-control"
	class={cn(
		'flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent',
		// The group's other controls (a slider, a stepper) set the value, so the spinner is noise.
		props.type === 'number' && 'no-spinner tabular-nums',
		className
	)}
	bind:value
	{...props}
/>
