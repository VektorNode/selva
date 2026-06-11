<script lang="ts">
	import * as THREE from 'three';
	import { Eye, EyeOff, ChevronRight, Search, X } from '@lucide/svelte';
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		scene: THREE.Scene;
		sceneVersion?: number;
	}

	let { scene = $bindable(), sceneVersion = 0 }: Props = $props();

	// Viewer aids (grid, floor, measurement overlay, CSS2D label layer) are tagged with these ids by
	// @selvajs/compute. They aren't scene content, so they're hidden from the object list.
	const HELPER_IDS = new Set(['grid', 'floor', 'label-layer', 'measure']);

	const getSceneObjects = () => {
		void sceneVersion;
		return scene.children.filter(
			(obj) =>
				!(obj instanceof THREE.Camera) &&
				!(obj instanceof THREE.Light) &&
				!HELPER_IDS.has(obj.userData?.id)
		);
	};

	const getLayerGroups = () => {
		const objects = getSceneObjects();
		const groups = new SvelteMap<string, THREE.Object3D[]>();

		for (const obj of objects) {
			const layer: string = obj.userData?.layer || obj.userData?.category || 'Default';
			if (!groups.has(layer)) groups.set(layer, []);
			groups.get(layer)!.push(obj);
		}

		return groups;
	};

	let hiddenUuids = new SvelteSet<string>();

	let collapsedLayers = new SvelteSet<string>();

	const setObjectVisible = (object: THREE.Object3D, visible: boolean) => {
		object.visible = visible;
		object.traverse((child) => {
			child.visible = visible;
		});
		if (visible) {
			hiddenUuids.delete(object.uuid);
		} else {
			hiddenUuids.add(object.uuid);
		}
	};

	const toggleObject = (object: THREE.Object3D) => {
		if (selectedUuids.has(object.uuid) && selectedUuids.size > 1) {
			const allObjects = getSceneObjects();
			const selected = allObjects.filter((o) => selectedUuids.has(o.uuid));
			const allHidden = selected.every((o) => hiddenUuids.has(o.uuid));
			for (const o of selected) setObjectVisible(o, allHidden);
		} else {
			setObjectVisible(object, hiddenUuids.has(object.uuid));
		}
	};

	const isLayerHidden = (objects: THREE.Object3D[]) =>
		objects.every((obj) => hiddenUuids.has(obj.uuid));

	const isLayerPartial = (objects: THREE.Object3D[]) => {
		const hidden = objects.filter((obj) => hiddenUuids.has(obj.uuid)).length;
		return hidden > 0 && hidden < objects.length;
	};

	const toggleLayer = (_layerName: string, objects: THREE.Object3D[]) => {
		const allHidden = isLayerHidden(objects);
		for (const obj of objects) {
			setObjectVisible(obj, allHidden);
		}
	};

	const toggleLayerCollapsed = (layerName: string) => {
		if (collapsedLayers.has(layerName)) {
			collapsedLayers.delete(layerName);
		} else {
			collapsedLayers.add(layerName);
		}
	};

	const prettyType = (type: string) =>
		type
			.replace(/^Line(Segments)?2$/, 'Curve')
			.replace('Mesh', '')
			.replace('Object3D', 'Obj') || type;

	const getObjectLabel = (object: THREE.Object3D) =>
		object.userData?.name || object.userData?.fileName || object.name || prettyType(object.type);

	const getTypeLabel = (object: THREE.Object3D) => prettyType(object.type);

	let searchQuery = $state('');

	const getFilteredLayerGroups = () => {
		const groups = getLayerGroups();
		if (!searchQuery.trim()) return groups;
		const q = searchQuery.toLowerCase();
		const filtered = new SvelteMap<string, THREE.Object3D[]>();
		for (const [layerName, objects] of groups) {
			const matchingObjects = layerName.toLowerCase().includes(q)
				? objects
				: objects.filter((obj) => getObjectLabel(obj).toLowerCase().includes(q));
			if (matchingObjects.length > 0) filtered.set(layerName, matchingObjects);
		}
		return filtered;
	};

	const getFlatVisibleUuids = (): string[] => {
		const result: string[] = [];
		for (const [layerName, objects] of getFilteredLayerGroups()) {
			if (!collapsedLayers.has(layerName)) {
				for (const obj of objects) result.push(obj.uuid);
			}
		}
		return result;
	};

	let selectedUuids = new SvelteSet<string>();
	let lastSelectedUuid = $state<string | null>(null);

	const selectObject = (uuid: string, event: MouseEvent) => {
		if (event.shiftKey && lastSelectedUuid) {
			const flat = getFlatVisibleUuids();
			const a = flat.indexOf(lastSelectedUuid);
			const b = flat.indexOf(uuid);
			if (a !== -1 && b !== -1) {
				const [lo, hi] = a < b ? [a, b] : [b, a];
				if (!event.ctrlKey && !event.metaKey) selectedUuids.clear();
				for (let i = lo; i <= hi; i++) selectedUuids.add(flat[i]);
			}
		} else if (event.ctrlKey || event.metaKey) {
			if (selectedUuids.has(uuid)) {
				selectedUuids.delete(uuid);
			} else {
				selectedUuids.add(uuid);
				lastSelectedUuid = uuid;
			}
		} else {
			selectedUuids.clear();
			selectedUuids.add(uuid);
			lastSelectedUuid = uuid;
		}
		if (!event.shiftKey) lastSelectedUuid = uuid;
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex h-full flex-col bg-card text-card-foreground"
	onmousedown={() => {
		selectedUuids.clear();
		lastSelectedUuid = null;
	}}
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
		{#each [...getFilteredLayerGroups()] as [layerName, objects] (layerName)}
			{@const layerHidden = isLayerHidden(objects)}
			{@const layerPartial = isLayerPartial(objects)}
			{@const collapsed = collapsedLayers.has(layerName)}

			<div class="gap-1 pl-1 pr-2 py-1 group flex items-center transition-colors hover:bg-muted">
				<button
					class="rounded p-0.5 shrink-0 text-muted-foreground transition-colors hover:text-muted-foreground"
					onclick={() => toggleLayerCollapsed(layerName)}
					aria-label={collapsed ? t.expandLayer : t.collapseLayer}
				>
					<ChevronRight
						class="h-3.5 w-3.5 transition-transform duration-150 {collapsed ? '' : 'rotate-90'}"
					/>
				</button>

				<button
					class="rounded p-1 shrink-0 transition-colors hover:bg-muted"
					onclick={() => toggleLayer(layerName, objects)}
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

			{#if !collapsed}
				<div role="listbox" aria-multiselectable="true" class="ml-3 border-l border-border">
					{#each objects as object (object.uuid)}
						{@const hidden = hiddenUuids.has(object.uuid)}
						{@const selected = selectedUuids.has(object.uuid)}
						<div
							role="option"
							aria-selected={selected}
							tabindex="-1"
							class="gap-1.5 pl-5 pr-2 py-0.5 flex cursor-pointer items-center transition-colors
								{selected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted'}
								{hidden ? 'opacity-40' : ''}"
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
									toggleObject(object);
								}}
								title={hidden ? t.showObject : t.hideObject}
								aria-label={hidden ? t.showObject : t.hideObject}
							>
								{#if hidden}
									<EyeOff class="h-3 w-3 text-muted-foreground/60" />
								{:else}
									<Eye class="h-3 w-3 text-muted-foreground" />
								{/if}
							</button>

							<!-- Object name -->
							<span
								class="min-w-0 text-xs flex-1 truncate {hidden
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
		{#if getSceneObjects().length === 0}
			<div class="py-12 flex flex-col items-center justify-center text-center">
				<EyeOff class="mb-2 h-5 w-5 text-muted-foreground/30" />
				<p class="text-xs text-muted-foreground">{t.noObjects}</p>
			</div>
		{:else if getFilteredLayerGroups().size === 0}
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
