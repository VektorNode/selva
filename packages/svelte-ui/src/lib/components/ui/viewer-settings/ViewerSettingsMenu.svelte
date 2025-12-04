<script lang="ts">
  import { ChevronUp, RotateCcw, Eye, Grid3X3, Maximize2, Lightbulb } from '@lucide/svelte';

  interface Props {
    scene?: any;
    camera?: any;
    controls?: any;
    onRefocus?: () => void;
    onGridToggle?: (enabled: boolean) => void;
    onAutoLightToggle?: (enabled: boolean) => void;
  }

  let {
    scene,
    camera,
    controls,
    onRefocus,
    onGridToggle,
    onAutoLightToggle,
  }: Props = $props();

  let isOpen = $state(false);
  let showGrid = $state(false);
  let autoLight = $state(true);

  function resetCamera() {
    if (!scene || !camera || !controls) return;

    const THREE = (window as any).THREE;
    const box3 = new THREE.Box3();
    const meshes = scene.children.filter((obj: any) => obj instanceof THREE.Mesh);

    if (meshes.length > 0) {
      meshes.forEach((mesh: any) => {
        box3.expandByObject(mesh);
      });

      const size = box3.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));

      const center = box3.getCenter(new THREE.Vector3());
      camera.position.copy(center);
      camera.position.z += cameraZ * 1.2;
      camera.lookAt(center);
      controls.target.copy(center);
      controls.update();
    }
  }

  function toggleGrid() {
    if (!scene) return;

    showGrid = !showGrid;

    const gridName = 'viewer-grid-helper';
    const existingGrid = scene.getObjectByName(gridName);

    if (existingGrid) {
      scene.remove(existingGrid);
      existingGrid.geometry?.dispose();
      existingGrid.material?.dispose();
    } else {
      const THREE = (window as any).THREE;
      const size = 100;
      const divisions = 10;
      const gridHelper = new THREE.GridHelper(size, divisions);
      gridHelper.name = gridName;
      gridHelper.position.y = 0;
      scene.add(gridHelper);
    }

    onGridToggle?.(showGrid);
  }

  function refocusCamera() {
    resetCamera();
    onRefocus?.();
  }

  function toggleAutoLight() {
    autoLight = !autoLight;
    onAutoLightToggle?.(autoLight);
  }

  function fitToView() {
    refocusCamera();
  }
</script>

<div class="relative">
  <!-- Menu Toggle Button -->
  <button
    class="absolute bottom-6 left-6 z-40 flex h-12 w-12 items-center justify-center rounded-lg bg-white shadow-lg transition-all hover:shadow-xl hover:bg-gray-50 active:scale-95"
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
    <div
      class="absolute bottom-20 left-6 z-40 flex min-w-60 flex-col gap-2 rounded-lg bg-white p-3 shadow-xl border border-gray-200 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div class="px-2 py-1">
        <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider">Viewer Settings</h3>
      </div>

      <hr class="my-1 border-gray-200" />

      <!-- Refocus/Reset View -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
        onclick={refocusCamera}
        title="Reset camera to fit all objects in view"
      >
        <Maximize2 class="h-4 w-4" />
        <span>Refocus View</span>
      </button>

      <!-- Fit to View -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
        onclick={fitToView}
        title="Fit model to viewport"
      >
        <Eye class="h-4 w-4" />
        <span>Fit to View</span>
      </button>

      <!-- Reset Camera -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-amber-50 hover:text-amber-700"
        onclick={resetCamera}
        title="Reset camera to default position"
      >
        <RotateCcw class="h-4 w-4" />
        <span>Reset Camera</span>
      </button>

      <hr class="my-1 border-gray-200" />

      <!-- Toggle Grid -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors {showGrid
          ? 'bg-green-50 text-green-700'
          : 'text-gray-700 hover:bg-green-50 hover:text-green-700'}"
        onclick={toggleGrid}
        title={showGrid ? 'Hide grid' : 'Show grid for reference'}
      >
        <Grid3X3 class="h-4 w-4" />
        <span>{showGrid ? 'Hide Grid' : 'Show Grid'}</span>
      </button>

      <!-- Toggle Auto Lighting -->
      <button
        class="flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors {autoLight
          ? 'bg-purple-50 text-purple-700'
          : 'text-gray-700 hover:bg-purple-50 hover:text-purple-700'}"
        onclick={toggleAutoLight}
        title="Auto-adjust lighting for better visibility"
      >
        <Lightbulb class="h-4 w-4" />
        <span>{autoLight ? 'Auto Light On' : 'Auto Light Off'}</span>
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

  <!-- Backdrop to close menu when clicking outside -->
  {#if isOpen}
    <button
      type="button"
      class="fixed inset-0 z-30 cursor-default"
      aria-label="Close viewer settings menu"
      onclick={() => (isOpen = false)}
      onkeydown={(e) => e.key === 'Escape' && (isOpen = false)}
    ></button>
  {/if}
</div>

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
