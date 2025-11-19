<script lang="ts">
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import type { AvailableParameter } from '$lib/types/schema';
	import * as Card from '$lib/components/ui/card';
	import { inputColor, outputColor } from '../styles';

	interface Props {
		parameter: AvailableParameter;
		category: 'input' | 'output';
	}

	let { parameter, category }: Props = $props();

	let isDragging = $state(false);

	function handleDragStart(e: DragEvent) {
		isDragging = true;
		dragStore.set({
			type: 'parameter',
			data: parameter,
			sourceType: category
		});

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'copy';
			e.dataTransfer.setData('text/plain', parameter.id);
		}
	}

	function handleDragEnd() {
		isDragging = false;
		dragStore.clear();
	}
</script>

<Card.Root
	class={`
    mb-2 flex cursor-grab flex-row items-center
    justify-between gap-4 rounded-xl border-2 border-transparent
    p-3 transition-all hover:border-primary
    hover:bg-muted ${category === 'input' ? inputColor : outputColor}
    ${isDragging ? 'cursor-grabbing opacity-50' : ''}
  `}
	draggable="true"
	role="button"
	ondragstart={handleDragStart}
	ondragend={handleDragEnd}
>
	<div class="flex flex-1 items-center gap-3">
		<strong class="text-foreground">{parameter.nickname || parameter.name}</strong>
		<span class="rounded bg-primary/10 px-2 py-1 text-sm text-primary">
			{parameter.paramType}
		</span>
	</div>
	<span class="cursor-grab font-bold text-muted-foreground select-none">⋮⋮</span>
</Card.Root>
