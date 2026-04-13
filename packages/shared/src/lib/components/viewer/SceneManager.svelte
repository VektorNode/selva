<script lang="ts">
	import * as THREE from 'three';
	import { Eye, EyeOff } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		scene: THREE.Scene;
	}

	let { scene = $bindable() }: Props = $props();

	// Get visible scene objects (exclude cameras and lights)
	const getSceneObjects = () => {
		return scene.children.filter(
			(obj) => !(obj instanceof THREE.Camera) && !(obj instanceof THREE.Light)
		);
	};

	// Track hidden UUIDs in Svelte state so the UI re-renders on toggle.
	// Mutating object.visible directly on a Three.js object is invisible to Svelte.
	let hiddenUuids = new SvelteSet<string>();

	const toggleVisibility = (object: THREE.Object3D) => {
		object.visible = !object.visible;
		object.traverse((child) => {
			child.visible = object.visible;
		});
		if (hiddenUuids.has(object.uuid)) {
			hiddenUuids.delete(object.uuid);
		} else {
			hiddenUuids.add(object.uuid);
		}
	};
</script>

<div class="flex h-full flex-col bg-card text-card-foreground">
	<!-- Header -->
	<div class="px-4 py-3 border-b border-border">
		<p class="text-xs font-medium tracking-wider text-muted-foreground uppercase">Scene</p>
	</div>

	<!-- Objects List -->
	<div class="py-2 flex-1 overflow-y-auto">
		{#each getSceneObjects() as object (object.uuid)}
			{@const hidden = hiddenUuids.has(object.uuid)}
			<div
				class="group gap-2 px-3 py-1.5 flex items-center transition-colors hover:bg-muted/50 {hidden
					? 'rounded-r italic opacity-40'
					: ''}"
			>
				<!-- Visibility Toggle -->
				<button
					class="rounded p-1 shrink-0 transition-colors hover:bg-muted"
					onclick={() => toggleVisibility(object)}
					title={hidden ? 'Show' : 'Hide'}
					aria-label={hidden ? 'Show object' : 'Hide object'}
				>
					{#if hidden}
						<EyeOff class="h-3.5 w-3.5 text-muted-foreground/60" />
					{:else}
						<Eye class="h-3.5 w-3.5 text-muted-foreground" />
					{/if}
				</button>

				<!-- Object Name -->
				<span
					class="min-w-0 text-sm flex-1 truncate {hidden
						? 'text-muted-foreground line-through'
						: ''}"
				>
					{object.userData?.fileName || object.name || object.type}
				</span>

				<!-- Type badge -->
				<span
					class="rounded px-1.5 py-0.5 font-medium shrink-0 bg-muted text-[10px] text-muted-foreground"
				>
					{object.type.replace('Mesh', '').replace('Object3D', 'Obj') || object.type}
				</span>
			</div>
		{/each}
	</div>

	<!-- Empty State -->
	{#if getSceneObjects().length === 0}
		<div class="py-12 flex flex-col items-center justify-center text-center">
			<EyeOff class="mb-2 h-5 w-5 text-muted-foreground/30" />
			<p class="text-xs text-muted-foreground">No objects</p>
		</div>
	{/if}
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
