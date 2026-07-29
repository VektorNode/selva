<script lang="ts">
	import * as THREE from 'three';
	import { Eye, EyeOff, ChevronRight, Search, X } from '@lucide/svelte';
	import {
		getObjectLabel,
		getTrackingKey,
		getTypeLabel,
		type SceneOutliner
	} from '@selvajs/visualization/scene';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		/**
		 * Owned by `Viewer.svelte`, not built here: this panel unmounts when it is closed, and
		 * hidden objects have to stay hidden — and keep being re-hidden after each solve — while it
		 * is. Its state is backed by SvelteSets, so mutating one re-renders this list.
		 */
		outliner: SceneOutliner;
		sceneVersion?: number;
	}

	let { outliner, sceneVersion = 0 }: Props = $props();

	// All list logic (content filtering, layer grouping, search, visibility, selection) lives in
	// @selvajs/visualization/scene. This component only renders it and forwards clicks.
	// Derived, not destructured: the prop is reassignable, and these must follow it.
	const hidden = $derived(outliner.visibility.hidden);
	const selected = $derived(outliner.selection.selected);
	const collapsed = $derived(outliner.collapsed);

	// Mirrored into runes because the outliner holds them as plain fields, not sets. Both start
	// fresh: the search box and the shift-anchor are panel state, so reopening the panel clears
	// them, while hiding and collapse persist in the outliner that outlives it.
	let searchQuery = $state('');
	let anchor = $state<string | null>(null);

	$effect(() => outliner.onAnchorChange((next) => (anchor = next)));

	// `scene.children` is a plain array the render layer mutates in place, so a solve bumping
	// `sceneVersion` is the only signal that content changed. Both derivations below read it, which
	// is what makes one walk per solve serve every template site that needs the list.
	const sceneObjects = $derived.by(() => {
		void sceneVersion;
		return outliner.objects();
	});

	const layerGroups = $derived.by(() => {
		void sceneVersion;
		void searchQuery;
		outliner.searchQuery = searchQuery;
		return outliner.layerGroups();
	});

	// Hidden state is keyed by Grasshopper identity, not by uuid, so ask the outliner rather than
	// looking the object up in the set directly. Touching `hidden` registers the reactive read that
	// re-renders this row when the eye is clicked.
	// `SvelteSet.has()` is itself the reactive read, so go through the set rather than calling
	// `visibility.isHidden` — that reads the set through a plain reference inside the outliner and
	// would not re-render this row.
	const isObjectHidden = (object: THREE.Object3D) => hidden.has(getTrackingKey(object));

	// Same reason: count through the reactive set so the layer's tri-state eye tracks its objects.
	const hiddenCount = (objects: THREE.Object3D[]) =>
		objects.filter((object) => isObjectHidden(object)).length;

	// Reading `anchor` keeps the shift-range dependent on it; the outliner owns the value.
	const selectObject = (uuid: string, event: MouseEvent) => {
		void anchor;
		outliner.select(uuid, {
			shiftKey: event.shiftKey,
			toggleKey: event.ctrlKey || event.metaKey
		});
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex h-full flex-col bg-card text-card-foreground"
	onmousedown={() => outliner.selection.clear()}
>
	<div class="px-3 py-2 gap-2 flex items-center border-b border-border">
		<Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
		<input
			class="min-w-0 text-xs flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50"
			placeholder={t.searchObjects}
			bind:value={searchQuery}
		/>
		{#if searchQuery}
			<button onclick={() => (searchQuery = '')} aria-label={t.clearSearch}>
				<X
					class="h-3.5 w-3.5 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
				/>
			</button>
		{/if}
	</div>

	<div class="py-1 flex-1 overflow-y-auto">
		{#each [...layerGroups] as [layerName, objects] (layerName)}
			{@const numHidden = hiddenCount(objects)}
			{@const layerHidden = objects.length > 0 && numHidden === objects.length}
			{@const layerPartial = numHidden > 0 && numHidden < objects.length}
			{@const isCollapsed = collapsed.has(layerName)}

			<div class="gap-1 pl-1 pr-2 py-1 group flex items-center transition-colors hover:bg-muted">
				<button
					class="rounded p-0.5 shrink-0 text-muted-foreground transition-colors hover:text-muted-foreground"
					onclick={() => outliner.toggleCollapsed(layerName)}
					aria-label={isCollapsed ? t.expandLayer : t.collapseLayer}
				>
					<ChevronRight
						class="h-3.5 w-3.5 transition-transform duration-150 {isCollapsed ? '' : 'rotate-90'}"
					/>
				</button>

				<button
					class="rounded p-1 shrink-0 transition-colors hover:bg-muted"
					onclick={() => outliner.visibility.toggleLayer(objects)}
					title={layerHidden ? t.showLayer : t.hideLayer}
					aria-label={layerHidden ? t.showLayer : t.hideLayer}
				>
					{#if layerHidden}
						<EyeOff class="h-3.5 w-3.5 text-muted-foreground/40" />
					{:else if layerPartial}
						<Eye class="h-3.5 w-3.5 text-muted-foreground/60" />
					{:else}
						<Eye class="h-3.5 w-3.5 text-muted-foreground" />
					{/if}
				</button>

				<span
					class="min-w-0 text-xs font-medium flex-1 truncate {layerHidden
						? 'text-muted-foreground/40 line-through'
						: 'text-foreground'}"
				>
					{layerName}
				</span>

				<span class="shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
					{objects.length}
				</span>
			</div>

			{#if !isCollapsed}
				<div role="listbox" aria-multiselectable="true" class="ml-3 border-l border-border">
					{#each objects as object (object.uuid)}
						<!-- Visibility is keyed by Grasshopper identity (so it survives a solve), selection
						     by uuid (so it does not) — hence the two different lookups. -->
						{@const isHidden = isObjectHidden(object)}
						{@const isSelected = selected.has(object.uuid)}
						<div
							role="option"
							aria-selected={isSelected}
							tabindex="-1"
							class="gap-1.5 pl-5 pr-2 py-0.5 flex cursor-pointer items-center transition-colors
								{isSelected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted'}
								{isHidden ? 'opacity-40' : ''}"
							onmousedown={(e) => {
								e.stopPropagation();
								if (e.shiftKey) e.preventDefault();
							}}
							onclick={(e) => selectObject(object.uuid, e)}
							onkeydown={(e) =>
								e.key === 'Enter' && selectObject(object.uuid, e as unknown as MouseEvent)}
						>
							<!-- Object visibility toggle -->
							<button
								class="rounded p-1 shrink-0 transition-colors hover:bg-muted"
								onclick={(e) => {
									e.stopPropagation();
									outliner.toggleObject(object);
								}}
								title={isHidden ? t.showObject : t.hideObject}
								aria-label={isHidden ? t.showObject : t.hideObject}
							>
								{#if isHidden}
									<EyeOff class="h-3 w-3 text-muted-foreground/60" />
								{:else}
									<Eye class="h-3 w-3 text-muted-foreground" />
								{/if}
							</button>

							<!-- Object name -->
							<span
								class="min-w-0 text-xs flex-1 truncate {isHidden
									? 'text-muted-foreground line-through'
									: 'text-foreground/80'}"
							>
								{getObjectLabel(object)}
							</span>

							<!-- Type badge -->
							<span
								class="rounded px-1 py-0.5 font-medium shrink-0 bg-muted text-[9px] text-muted-foreground/70"
							>
								{getTypeLabel(object)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/each}

		<!-- Empty state -->
		{#if sceneObjects.length === 0}
			<div class="py-12 flex flex-col items-center justify-center text-center">
				<EyeOff class="mb-2 h-5 w-5 text-muted-foreground/30" />
				<p class="text-xs text-muted-foreground">{t.noObjects}</p>
			</div>
		{:else if layerGroups.size === 0}
			<div class="py-12 flex flex-col items-center justify-center text-center">
				<Search class="mb-2 h-5 w-5 text-muted-foreground/30" />
				<p class="text-xs text-muted-foreground">
					{t.noResultsFor.replace('{query}', searchQuery)}
				</p>
			</div>
		{/if}
	</div>
</div>

<style>
	div::-webkit-scrollbar {
		width: 4px;
	}
	div::-webkit-scrollbar-track {
		background: transparent;
	}
	div::-webkit-scrollbar-thumb {
		background: hsl(var(--muted-foreground) / 0.15);
		border-radius: 2px;
	}
</style>
