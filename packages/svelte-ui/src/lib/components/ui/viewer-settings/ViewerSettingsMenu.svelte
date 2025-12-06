<script lang="ts">
  import { ChevronUp, Eye, Maximize } from '@lucide/svelte';

  interface Props {
    scene?: any;
    camera?: any;
    controls?: any;
    onRefocus?: () => void;
    onFullscreenToggle?: (enabled: boolean) => void;
  }

  let {
    scene,
    camera,
    controls,
    onRefocus,
    onFullscreenToggle,
  }: Props = $props();

  let isOpen = $state(false);
  let isFullscreen = $state(false);

  async function loadThree() {
    if (!(window as any).THREE) {
      const THREE = await import('three');
      (window as any).THREE = THREE;
    }
    return (window as any).THREE;
  }

  async function fitToView() {
    if (!scene || !camera || !controls) return;

    const THREE = await loadThree();
    const box3 = new THREE.Box3();

    // Get all visible meshes except floor
    const meshes = (scene as any).children.filter((obj: any) => {
      return obj.visible && obj.userData?.id !== 'floor' && obj.type === 'Mesh';
    });

    if (meshes.length === 0) return;

    // Compute bounding box
    meshes.forEach((mesh: any) => {
      box3.expandByObject(mesh);
    });

    const center = box3.getCenter(new THREE.Vector3());
    const size = box3.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera as any).fov * (Math.PI / 180);
    let distance = maxDim / (2 * Math.tan(fov / 2));

    // Add padding
    distance *= 1.5;

    // Position camera
    const direction = (camera as any).position.clone().sub((controls as any).target).normalize();
    (camera as any).position.copy(center.clone().add(direction.multiplyScalar(distance)));
    (controls as any).target.copy(center);
    (controls as any).update();

    onRefocus?.();
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    onFullscreenToggle?.(isFullscreen);
  }
</script>

<!-- Menu Toggle Button -->
<button
  class="absolute bottom-4 left-4 z-50 flex h-12 w-12 items-center justify-center rounded-lg bg-white shadow-lg transition-all hover:shadow-xl hover:bg-gray-50 active:scale-95"
  onclick={() => (isOpen = !isOpen)}
  title={isOpen ? 'Close viewer settings' : 'Open viewer settings'}
>
  <ChevronUp
    class="h-6 w-6 text-gray-700 transition-transform"
    style={isOpen ? 'transform: rotate(0deg)' : 'transform: rotate(180deg)'}
  />
</button>

  <!-- Settings Menu (conditional) -->
  {#if isOpen}
    <button
      type="button"
      class="fixed inset-0 z-40 cursor-default"
      onclick={() => (isOpen = false)}
      aria-label="Close viewer settings"
      tabindex="-1"
    ></button>
    <div
      class="absolute bottom-20 left-4 z-50 flex min-w-60 flex-col gap-2 rounded-lg bg-white p-3 shadow-xl border border-gray-200 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div class="px-2 py-1">
        <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider">Viewer Settings</h3>
      </div>

      <hr class="my-1 border-gray-200" />

      <!-- Fit to View (F) -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
        onclick={fitToView}
        title="Fit model to viewport (F)"
      >
        <Eye class="h-4 w-4" />
        <span>Fit to View</span>
        <kbd class="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">F</kbd>
      </button>

      <hr class="my-1 border-gray-200" />

      <!-- Toggle Fullscreen -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors {isFullscreen
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'}"
        onclick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
      >
        <Maximize class="h-4 w-4" />
        <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
      </button>

      <hr class="my-1 border-gray-200" />

      <!-- Info Section -->
      <div class="px-2 py-2 text-xs text-gray-500">
        <p class="font-medium text-gray-600 mb-1">Camera Controls:</p>
        <ul class="space-y-0.5 text-gray-500">
          <li>• <span class="font-medium">Left Drag</span> - Rotate</li>
          <li>• <span class="font-medium">Right Drag</span> - Pan</li>
          <li>• <span class="font-medium">Scroll</span> - Zoom</li>
          <li>• <span class="font-medium">F</span> - Fit to view</li>
        </ul>
      </div>
    </div>
  {/if}


<style>
  @keyframes slide-in-from-bottom-2 {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  :global(.animate-in) {
    animation: slide-in-from-bottom-2 0.2s ease-out;
  }

  :global(.fade-in) {
    animation: fade-in 0.2s ease-out;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
