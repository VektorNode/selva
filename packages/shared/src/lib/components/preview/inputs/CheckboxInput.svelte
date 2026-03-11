<script lang="ts">
	import type { SupportedTypes } from '$lib/types/generated';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Field from '$lib/components/ui/field';

	interface Props {
		inputId: string;
		value?: boolean;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value = $bindable(), onChange, disabled = false }: Props = $props();
</script>

<Field.Field orientation="horizontal">
	<Checkbox
		id={inputId}
		checked={typeof value === 'boolean' ? value : false}
		onCheckedChange={(state) => {
			value = state === true;
			onChange(state === true);
		}}
		{disabled}
	/>
	<Field.Label for={inputId} class="font-normal cursor-pointer text-muted-foreground">
		Enabled
	</Field.Label>
</Field.Field>
