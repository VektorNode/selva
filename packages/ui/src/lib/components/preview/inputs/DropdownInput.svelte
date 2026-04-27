<script lang="ts">
	import type { DropdownWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import * as Select from '$lib/components/ui/select';

	interface Props {
		value?: string;
		config?: DropdownWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { value, config, onChange, disabled = false }: Props = $props();

	const options = $derived(config?.options || {});
	const currentValue = $derived(value || '');
	const currentLabel = $derived(
		Object.entries(options).find(([_, expr]) => expr === currentValue)?.[0] ?? currentValue
	);
</script>

<Select.Root
	type="single"
	value={currentValue}
	onValueChange={(selected) => {
		if (selected) {
			value = selected;
			onChange(selected);
		}
	}}
	{disabled}
>
	<Select.Trigger class="w-full" {disabled}>
		{currentLabel || 'Select an option...'}
	</Select.Trigger>
	<Select.Content>
		{#each Object.entries(options) as [name, expr] (expr ?? name)}
			<Select.Item value={expr ?? name} label={name} />
		{/each}
	</Select.Content>
</Select.Root>
