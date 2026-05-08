<script lang="ts">
	import { Label } from '$lib/components/primitives/label/index.js';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: ComponentProps<typeof Label> = $props();
</script>

<Label
	bind:ref
	data-slot="field-label"
	class={cn(
		'group/field-label peer/field-label gap-2 leading-snug flex w-fit group-data-[disabled=true]/field:opacity-50',
		'[&>*]:data-[slot=field]:p-4 has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border',
		'has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 dark:has-data-[state=checked]:bg-primary/10',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</Label>
