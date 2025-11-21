<script lang="ts">
	interface Props {
		loading?: boolean;
		ready?: boolean;
		error?: boolean;
		serverUrl?: string;
	}

	let { loading = false, ready = false, error = false, serverUrl = '' }: Props = $props();
</script>

<div
	class="mb-8 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
>
	<div class="flex items-center gap-3">
		{#if loading}
			<div class="h-3 w-3 animate-pulse rounded-full bg-yellow-500"></div>
			<span class="text-slate-700 dark:text-slate-300">Loading rhino3dm...</span>
		{:else if ready}
			<div class="h-3 w-3 rounded-full bg-green-500"></div>
			<span class="font-medium text-green-700 dark:text-green-400">rhino3dm ready</span>
			{#if serverUrl}
				<span class="ml-auto text-sm text-slate-500 dark:text-slate-400">
					Server: {serverUrl}
				</span>
			{/if}
		{:else if error}
			<div class="h-3 w-3 rounded-full bg-red-500"></div>
			<span class="text-red-700 dark:text-red-400">Failed to load</span>
		{/if}
	</div>
</div>
