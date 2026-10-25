<script lang="ts">
	import { Input } from '@selvajs/ui';
	import { iconNodeToPath, type IconNode } from '$lib/features/builder/option-assets';

	interface Props {
		/** The `lucide:<name>` the option already uses, highlighted in the grid. */
		current?: string;
		onPick: (icon: { name: string; path: string }) => void;
	}

	let { current, onPick }: Props = $props();

	// Past this the grid stops being scannable; the author narrows with the search instead.
	const MAX_SHOWN = 96;

	// Lucide's icon data is a few hundred KB, so it loads when a picker first opens rather than
	// with the builder. It is bundled, so the picker also works with Rhino offline.
	let icons = $state<{ name: string; node: IconNode }[]>([]);
	let query = $state('');

	$effect(() => {
		import('lucide').then(({ icons: all }) => {
			icons = Object.entries(all).map(([pascal, node]) => ({
				name: pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
				node: node as unknown as IconNode
			}));
		});
	});

	const matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return icons.filter((icon) => words.every((w) => icon.name.includes(w))).slice(0, MAX_SHOWN);
	});
</script>

<div class="flex w-72 flex-col gap-2">
	<Input bind:value={query} placeholder="Search icons" aria-label="Search icons" />
	{#if icons.length === 0}
		<p class="text-muted-foreground py-6 text-center text-xs">Loading icons…</p>
	{:else if matches.length === 0}
		<p class="text-muted-foreground py-6 text-center text-xs">No icon matches “{query}”.</p>
	{:else}
		<div class="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
			{#each matches as icon (icon.name)}
				{@const path = iconNodeToPath(icon.node)}
				<button
					type="button"
					title={icon.name}
					aria-label={icon.name}
					onclick={() => onPick({ name: icon.name, path })}
					class={`hover:bg-accent flex aspect-square items-center justify-center rounded-sm ${
						current === `lucide:${icon.name}` ? 'bg-primary/15 text-primary' : ''
					}`}
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4"
						aria-hidden="true"
					>
						<path d={path} />
					</svg>
				</button>
			{/each}
		</div>
	{/if}
</div>
