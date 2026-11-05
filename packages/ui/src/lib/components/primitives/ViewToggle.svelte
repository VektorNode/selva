<script lang="ts">
	import { Grid2x2, List } from '@lucide/svelte';
	import * as ToggleGroup from './toggle-group';

	type ViewMode = 'grid' | 'list';

	interface Props {
		mode: ViewMode;
		onChange: (mode: ViewMode) => void;
		size?: 'sm' | 'md';
	}

	let { mode, onChange, size = 'md' }: Props = $props();
</script>

<ToggleGroup.Root
	type="single"
	variant="outline"
	size={size === 'sm' ? 'sm' : 'default'}
	value={mode}
	onValueChange={(next) => {
		// A single-select group emits '' when the active item is clicked again; keep the mode.
		if (next === 'grid' || next === 'list') onChange(next);
	}}
>
	<ToggleGroup.Item value="grid" aria-label="Grid view" title="Grid view">
		<Grid2x2 />
	</ToggleGroup.Item>
	<ToggleGroup.Item value="list" aria-label="List view" title="List view">
		<List />
	</ToggleGroup.Item>
</ToggleGroup.Root>
