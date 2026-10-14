<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SupportedTypes } from '@selvajs/schemas';
	import { Checkbox } from '$lib/components/primitives/checkbox';

	interface Props {
		inputId: string;
		value?: boolean;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
		/** Rendered beside the box; must contain a label pointing at `inputId`. */
		children?: Snippet;
	}

	let { inputId, value = $bindable(), onChange, disabled = false, children }: Props = $props();
</script>

<div class="gap-2.5 min-h-6 min-w-0 flex items-center">
	<Checkbox
		id={inputId}
		checked={typeof value === 'boolean' ? value : false}
		onCheckedChange={(state) => {
			value = state === true;
			onChange(state === true);
		}}
		{disabled}
	/>
	{@render children?.()}
</div>
