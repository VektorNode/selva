<script lang="ts">
	interface Props {
		inputId: string;
		value?: string;
		onChange: (value: string) => void;
	}

	let { inputId, value = '#000000', onChange }: Props = $props();
</script>

<div class="gap-2 flex items-center">
	<input
		id={inputId}
		type="color"
		value={value || '#000000'}
		class="h-9 w-12 rounded p-1 cursor-pointer border border-input bg-background dark:bg-input/30"
		onchange={(e) => {
			const newValue = (e.currentTarget as HTMLInputElement).value;
			onChange(newValue);
		}}
	/>
	<span class="font-mono text-sm text-muted-foreground">{value || '#000000'}</span>
</div>
