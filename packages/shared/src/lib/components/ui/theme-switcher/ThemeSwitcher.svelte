<script lang="ts">
	import { themeStore, type Theme } from '$lib/stores/themeStore.svelte';
	import * as Select from '$lib/components/ui/select';
	import { Palette } from '@lucide/svelte';

	const themes: { value: Theme; label: string; description: string }[] = [
		{ value: 'neutral', label: 'Neutral', description: 'Classic grayscale' },
		{ value: 'selva', label: 'Selva', description: 'Forest green' },
		{ value: 'ocean', label: 'Ocean', description: 'Calm blue tones' },
		{ value: 'cyberpunk', label: 'Cyberpunk', description: 'Vibrant neon colors' }
	];

	let value = $state(themeStore.current);

	$effect(() => {
		if (value) {
			themeStore.set(value as Theme);
		}
	});

	const triggerContent = $derived(themes.find((t) => t.value === value)?.label ?? 'Select theme');
</script>

<Select.Root type="single" bind:value>
	<Select.Trigger class="gap-2 w-[140px]">
		<Palette size={14} />
		<span>{triggerContent}</span>
	</Select.Trigger>
	<Select.Content>
		{#each themes as theme}
			<Select.Item value={theme.value} label={theme.label}>
				<div class="flex flex-col items-start">
					<span class="font-medium text-sm">{theme.label}</span>
					<span class="text-xs text-muted-foreground">{theme.description}</span>
				</div>
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
