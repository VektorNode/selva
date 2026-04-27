<script lang="ts">
	import { Grid2x2, List } from '@lucide/svelte';

	type ViewMode = 'grid' | 'list';

	interface Props {
		mode: ViewMode;
		onChange: (mode: ViewMode) => void;
		size?: 'sm' | 'md';
	}

	let { mode, onChange, size = 'md' }: Props = $props();

	const btnClass = $derived(
		size === 'sm'
			? 'flex h-7 w-7 items-center justify-center rounded-md transition-colors'
			: 'flex h-8 w-8 items-center justify-center rounded-md transition-colors'
	);
	const iconClass = $derived(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4');
</script>

<div class="border-border bg-card inline-flex gap-0.5 rounded-md border p-0.5">
	<button
		type="button"
		title="Grid view"
		aria-label="Grid view"
		aria-pressed={mode === 'grid'}
		onclick={() => onChange('grid')}
		class="{btnClass} {mode === 'grid'
			? 'bg-muted text-foreground'
			: 'text-muted-foreground hover:text-foreground'}"
	>
		<Grid2x2 class={iconClass} />
	</button>
	<button
		type="button"
		title="List view"
		aria-label="List view"
		aria-pressed={mode === 'list'}
		onclick={() => onChange('list')}
		class="{btnClass} {mode === 'list'
			? 'bg-muted text-foreground'
			: 'text-muted-foreground hover:text-foreground'}"
	>
		<List class={iconClass} />
	</button>
</div>
