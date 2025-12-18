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
<div class="flex min-h-screen items-center justify-center">
	<div class="text-center">
		<div class="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-gray-900"></div>
		<p class="mt-4 text-gray-600">Loading...</p>
	</div>
</div>
