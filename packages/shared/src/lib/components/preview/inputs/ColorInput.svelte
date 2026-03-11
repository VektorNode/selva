<script lang="ts">
	interface Props {
		value?: string;
		onChange: (value: string) => void;
	}

	let { value = '#000000', onChange }: Props = $props();
</script>

<div class="gap-2 flex items-center">
	<input
		type="color"
		value={value || '#000000'}
		class="h-9 w-12 rounded p-1 cursor-pointer border border-input bg-background"
		onchange={(e) => {
			const newValue = (e.currentTarget as HTMLInputElement).value;
			onChange(newValue);
		}}
	/>
	<span class="font-mono text-sm text-muted-foreground">{value || '#000000'}</span>
</div>
