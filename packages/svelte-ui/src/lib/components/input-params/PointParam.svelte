<script lang="ts">
  import type { DataTreeDefault, PointInputType } from 'rhino-compute-core/grasshopper';
  import type { Point } from 'rhino-compute-core/geometry';
  import BaseParam from './BaseParam.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';

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
        <Label for="{input.name}-x" class="text-xs">X</Label>
        <Input
          type="number"
          id="{input.name}-x"
          value={entry.value.X}
          oninput={(e) =>
            updateCoordinate(entry.value, onUpdate, 'X', parseFloat(e.currentTarget.value))}
          step="0.1"
          class="w-full"
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="{input.name}-y" class="text-xs">Y</Label>
        <Input
          type="number"
          id="{input.name}-y"
          value={entry.value.Y}
          oninput={(e) =>
            updateCoordinate(entry.value, onUpdate, 'Y', parseFloat(e.currentTarget.value))}
          step="0.1"
          class="w-full"
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label for="{input.name}-z" class="text-xs">Z</Label>
        <Input
          type="number"
          id="{input.name}-z"
          value={entry.value.Z}
          oninput={(e) =>
            updateCoordinate(entry.value, onUpdate, 'Z', parseFloat(e.currentTarget.value))}
          step="0.1"
          class="w-full"
        />
      </div>
    </div>
  {/snippet}
</BaseParam>
