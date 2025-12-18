<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    // Redirect to the definition route on mount
    // The server load function will use the default from .env
    goto('/app', { replaceState: true });
  });
</script>

<!-- Show a loading state briefly -->
<div class="flex items-center justify-center min-h-screen">
  <div class="text-center">
    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
    <p class="mt-4 text-gray-600">Loading...</p>
  </div>
</div>
