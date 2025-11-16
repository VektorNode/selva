<script lang="ts">
	import type { DataTreeDefault, PointInputType } from 'rhino-compute-core/grasshopper';
	import type { Point } from 'rhino-compute-core/geometry';
	import BaseParam from './BaseParam.svelte';

	type Props = {
		input: PointInputType;
		value: Point | Point[] | DataTreeDefault<Point>;
	};

	let { input, value = $bindable() }: Props = $props();

	// Update a coordinate of a point
	function updateCoordinate(
		point: Point,
		onUpdate: (p: Point) => void,
		coord: 'X' | 'Y' | 'Z',
		value: number
	) {
		onUpdate({ ...point, [coord]: value });
	}
</script>

<BaseParam bind:value name={input.name}>
	{#snippet children({ entry, onUpdate })}
		<div class="grid grid-cols-3 gap-2">
			<div class="flex flex-col gap-1">
				<label class="text-xs text-gray-600" for="{input.name}-x">X</label>
				<input
					type="number"
					id="{input.name}-x"
					value={entry.value.X}
					oninput={(e) =>
						updateCoordinate(entry.value, onUpdate, 'X', parseFloat(e.currentTarget.value))}
					step="0.1"
					class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs text-gray-600" for="{input.name}-y">Y</label>
				<input
					type="number"
					id="{input.name}-y"
					value={entry.value.Y}
					oninput={(e) =>
						updateCoordinate(entry.value, onUpdate, 'Y', parseFloat(e.currentTarget.value))}
					step="0.1"
					class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs text-gray-600" for="{input.name}-z">Z</label>
				<input
					type="number"
					id="{input.name}-z"
					value={entry.value.Z}
					oninput={(e) =>
						updateCoordinate(entry.value, onUpdate, 'Z', parseFloat(e.currentTarget.value))}
					step="0.1"
					class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>
		</div>
	{/snippet}
</BaseParam>
