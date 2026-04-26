<script lang="ts">
	import { Grid2x2, List } from '@lucide/svelte';

	type ViewMode = 'grid' | 'list';

	interface Props {
		mode: ViewMode;
		onChange: (mode: ViewMode) => void;
	}

	let { mode, onChange }: Props = $props();

	const baseClass = 'flex h-8 w-8 items-center justify-center rounded-md transition-colors';
</script>

<div class="border-border bg-card inline-flex gap-0.5 rounded-md border p-0.5">
	<button
		type="button"
		title="Grid view"
		aria-label="Grid view"
		aria-pressed={mode === 'grid'}
		onclick={() => onChange('grid')}
		class="{baseClass} {mode === 'grid'
			? 'bg-muted text-foreground'
			: 'text-muted-foreground hover:text-foreground'}"
	>
		<Grid2x2 class="h-4 w-4" />
	</button>
	<button
		type="button"
		title="List view"
		aria-label="List view"
		aria-pressed={mode === 'list'}
		onclick={() => onChange('list')}
		class="{baseClass} {mode === 'list'
			? 'bg-muted text-foreground'
			: 'text-muted-foreground hover:text-foreground'}"
	>
		<List class="h-4 w-4" />
	</button>
</div>
