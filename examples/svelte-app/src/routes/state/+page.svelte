<script lang="ts">
	import { onMount } from 'svelte';

	let status = 'checking'; // 'checking' | 'success' | 'error'
	let result: any = null; //Sloppy any for JSON response
	let error: any = null; //Sloppy any to catch all error types
	let loading = false;

	async function healthCheck() {
		loading = true;
		status = 'checking';
		error = null;
		result = null;

		try {
			const response = await fetch('/api/check-health', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});

			if (!response.ok) {
				throw new Error(response.statusText);
			}

			result = await response.json();
			status = 'success';
		} catch (e: any) {
			//Sloppy any to catch all error types
			error = e.message;
			status = 'error';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await healthCheck();
	});
</script>

<div
	class="bg-linear-to-b min-h-screen from-slate-50 to-white p-8 dark:from-slate-900 dark:to-slate-800"
>
	<div class="mx-auto max-w-4xl">
		<header class="mb-12">
			<h1 class="mb-2 text-4xl font-bold text-slate-900 dark:text-white">Health Check</h1>
			<p class="text-slate-600 dark:text-slate-400">Monitor Rhino.Compute server status</p>
		</header>

		<div class="space-y-4">
			<!-- Status Card -->
			<div
				class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
			>
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-lg font-semibold text-slate-900 dark:text-white">Server Status</h2>
					<button
						onclick={healthCheck}
						disabled={loading}
						class="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:bg-slate-400"
					>
						{loading ? 'Checking...' : 'Check Again'}
					</button>
				</div>

				<!-- Status Indicator -->
				<div class="mb-4 flex items-center gap-3">
					{#if status === 'checking'}
						<div class="h-3 w-3 animate-pulse rounded-full bg-yellow-500"></div>
						<span class="text-slate-700 dark:text-slate-300">Checking server...</span>
					{:else if status === 'success'}
						<div class="h-3 w-3 rounded-full bg-green-500"></div>
						<span class="font-medium text-green-700 dark:text-green-400">Server is healthy</span>
					{:else if status === 'error'}
						<div class="h-3 w-3 rounded-full bg-red-500"></div>
						<span class="font-medium text-red-700 dark:text-red-400">Server error</span>
					{/if}
				</div>

				<!-- Error Message -->
				{#if error}
					<div
						class="rounded border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
					>
						<p class="mb-1 font-medium">Error</p>
						<p class="text-sm">{error}</p>
					</div>
				{/if}

				<!-- Result Data -->
				{#if result}
					<div class="mt-4">
						<h3 class="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Response</h3>
						<pre
							class="overflow-x-auto rounded bg-slate-100 p-4 text-sm text-slate-800 dark:bg-slate-900 dark:text-slate-200">{JSON.stringify(
								result,
								null,
								2
							)}</pre>
					</div>
				{/if}
			</div>

			<!-- Info Card -->
			<div
				class="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
			>
				<h3 class="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
					About Health Checks
				</h3>
				<p class="text-sm text-slate-600 dark:text-slate-400">
					This endpoint verifies that the Rhino.Compute server is running and responsive. Regular
					health checks help ensure system reliability and monitor server availability.
				</p>
			</div>
		</div>

		<footer class="mt-8 border-t border-slate-200 pt-6 dark:border-slate-700">
			<a href="./" class="text-sm text-sky-600 hover:underline"> ← Back to home </a>
		</footer>
	</div>
</div>
