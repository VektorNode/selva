<script lang="ts">
	import { InputGroup } from '@selvajs/ui';
	import { Search } from '@lucide/svelte';
	import { iconNodeToPath, listIcons, type IconNode } from '$lib/features/builder/option-assets';

	interface Props {
		/** The icon already in use; a `lucide:<name>` is ringed in the grid. */
		current?: string;
		/** `lucide:<name>`s other options of this list use, offered first. */
		used?: string[];
		onPick: (icon: { name: string; path: string }) => void;
		onClear?: () => void;
	}

	let { current, used = [], onPick, onClear }: Props = $props();

	// Lucide has no tags, so an empty search would list its first icons alphabetically. These are
	// the ones a Grasshopper definition's options tend to need.
	const CATEGORIES: Record<string, string[]> = {
		Shapes: [
			'square',
			'circle',
			'triangle',
			'hexagon',
			'pentagon',
			'diamond',
			'box',
			'cylinder',
			'cone',
			'torus',
			'shapes',
			'frame',
			'square-dot'
		],
		Layout: [
			'layout-grid',
			'grid-3x3',
			'grid-2x2',
			'columns-2',
			'columns-3',
			'rows-2',
			'rows-3',
			'panel-left',
			'panel-top',
			'layers',
			'layers-2',
			'blocks'
		],
		Building: [
			'building',
			'building-2',
			'house',
			'warehouse',
			'factory',
			'landmark',
			'store',
			'hotel',
			'door-open',
			'fence',
			'brick-wall',
			'tent'
		],
		Nature: [
			'trees',
			'tree-pine',
			'tree-deciduous',
			'leaf',
			'mountain',
			'waves',
			'sun',
			'cloud',
			'droplet',
			'flame',
			'snowflake'
		],
		Tools: [
			'ruler',
			'ruler-dimension-line',
			'drafting-compass',
			'pen-tool',
			'spline',
			'paintbrush',
			'palette',
			'wrench',
			'hammer',
			'sliders-horizontal',
			'scan'
		],
		Arrows: [
			'arrow-up',
			'arrow-right',
			'arrow-down',
			'arrow-left',
			'move',
			'move-3d',
			'rotate-3d',
			'scale-3d',
			'axis-3d',
			'maximize-2',
			'minimize-2'
		]
	};
	// Past this the grid stops being scannable; the author narrows with the search instead.
	const MAX_SHOWN = 96;

	// Lucide's icon data is a few hundred KB, so it loads when a picker first opens rather than
	// with the builder. It is bundled, so the picker also works with Rhino offline.
	let byName = $state<Map<string, IconNode>>(new Map());
	let query = $state('');
	let category = $state('Shapes');
	let hovered = $state<string | null>(null);

	$effect(() => {
		import('lucide').then(({ icons: all }) => {
			byName = new Map(listIcons(all).map((icon) => [icon.name, icon.node]));
		});
	});

	const strip = (iconName: string) => iconName.replace(/^lucide:/, '');
	const currentName = $derived(current ? strip(current) : undefined);
	const usedNames = $derived([...new Set(used.map(strip))].filter((name) => byName.has(name)));

	const searchResults = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (words.length === 0) return [];
		return [...byName.keys()].filter((name) => words.every((w) => name.includes(w)));
	});
	const categoryNames = $derived(CATEGORIES[category].filter((name) => byName.has(name)));
</script>

{#snippet grid(names: string[])}
	<div class="grid grid-cols-8 gap-1">
		{#each names as name (name)}
			{@const node = byName.get(name)}
			{#if node}
				{@const path = iconNodeToPath(node)}
				<button
					type="button"
					aria-label={name}
					onclick={() => onPick({ name, path })}
					onpointerenter={() => (hovered = name)}
					onpointerleave={() => (hovered = null)}
					onfocus={() => (hovered = name)}
					onblur={() => (hovered = null)}
					class={`hover:bg-accent focus-visible:ring-ring text-foreground flex aspect-square items-center justify-center rounded-md outline-none focus-visible:ring-2 ${
						name === currentName ? 'bg-primary/10 text-primary ring-primary ring-1' : ''
					}`}
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-4.5"
						aria-hidden="true"
					>
						<path d={path} />
					</svg>
				</button>
			{/if}
		{/each}
	</div>
{/snippet}

<div class="flex w-full min-w-0 flex-col gap-3">
	<InputGroup.Root>
		<InputGroup.Addon><Search /></InputGroup.Addon>
		<InputGroup.Input
			bind:value={query}
			oninput={() => (hovered = null)}
			placeholder="Search icons"
			aria-label="Search icons"
		/>
	</InputGroup.Root>

	{#if byName.size === 0}
		<p class="text-muted-foreground py-8 text-center text-xs">Loading icons…</p>
	{:else if query.trim()}
		<div class="flex flex-col gap-1.5">
			<span class="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
				{searchResults.length === 0
					? `No icon matches “${query.trim()}”`
					: searchResults.length > MAX_SHOWN
						? `First ${MAX_SHOWN} of ${searchResults.length}. Keep typing to narrow it down`
						: `${searchResults.length} ${searchResults.length === 1 ? 'icon' : 'icons'}`}
			</span>
			<div class="max-h-56 overflow-y-auto">{@render grid(searchResults.slice(0, MAX_SHOWN))}</div>
		</div>
	{:else}
		{#if usedNames.length > 0}
			<div class="flex flex-col gap-1.5">
				<span class="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
					Used in this list
				</span>
				{@render grid(usedNames)}
			</div>
		{/if}
		<div class="flex flex-col gap-1.5">
			<div class="flex flex-wrap gap-1" role="group" aria-label="Icon categories">
				{#each Object.keys(CATEGORIES) as name (name)}
					<button
						type="button"
						aria-pressed={category === name}
						onclick={() => (category = name)}
						class={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
							category === name
								? 'bg-primary text-primary-foreground border-primary'
								: 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
						}`}
					>
						{name}
					</button>
				{/each}
			</div>
			{@render grid(categoryNames)}
		</div>
	{/if}

	<div class="border-border flex min-h-7 items-center gap-2 border-t pt-2 text-xs">
		<span class="text-muted-foreground min-w-0 flex-1 truncate font-mono">
			{hovered ?? currentName ?? 'No icon'}
		</span>
		{#if currentName && onClear}
			<button
				type="button"
				onclick={onClear}
				class="text-muted-foreground hover:text-foreground rounded-sm px-1.5 py-0.5 hover:underline"
			>
				Remove icon
			</button>
		{/if}
	</div>
</div>
